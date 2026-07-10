"""Фоновая синхронизация с Moonraker: автоимпорт и автосписание печатей.

Поллер (app/workers/poller.py) периодически вызывает poll_all():
  - по каждому активному Moonraker-принтеру читается история заданий;
  - новые завершённые задания (после «водяного знака» printer-а) импортируются
    как print job (source="moonraker");
  - если включено автосписание и каждый инструмент с расходом сопоставляется
    со слотом принтера (slot_index == tool_index, в слоте есть катушка),
    печать списывается автоматически; иначе остаётся черновиком для ручного
    подтверждения с главной страницы.

Водяной знак — max(end_time) уже увиденных заданий, хранится в app_settings
(ключ moonraker_watermark:<printer_id>). При первом опросе принтера история не
импортируется задним числом: знак просто ставится на самое свежее задание.
"""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret
from app.models import AppSetting, Printer, PrinterSlot, PrintJob, User
from app.services import print_job_service, settings_service
from app.services.moonraker import MoonrakerClient, job_to_parsed

log = logging.getLogger("moonraker_sync")

# Автоимпорт новых завершённых заданий (черновики списания). Безопасно: по
# умолчанию включён, старая история не трогается благодаря водяному знаку.
AUTO_IMPORT_KEY = "moonraker_auto_import"
# Полностью автоматическое списание при полном сопоставлении со слотами.
# Списывает материал без подтверждения — по умолчанию выключено.
AUTO_CONSUME_KEY = "moonraker_auto_consume"

WATERMARK_PREFIX = "moonraker_watermark:"


def _client(printer: Printer) -> MoonrakerClient:
    key = (
        decrypt_secret(printer.moonraker_api_key_encrypted)
        if printer.moonraker_api_key_encrypted
        else None
    )
    return MoonrakerClient(printer.moonraker_url, api_key=key)


def _imported_job_ids(db: Session, printer: Printer) -> set[str]:
    rows = db.scalars(
        select(PrintJob).where(
            PrintJob.owner_user_id == printer.owner_user_id,
            PrintJob.source == "moonraker",
        )
    )
    out = set()
    for pj in rows:
        mid = (pj.parsed_metadata or {}).get("moonraker_job_id")
        if mid:
            out.add(str(mid))
    return out


def _consumed_names(db: Session, printer: Printer) -> set[str]:
    """Имена файлов уже списанных печатей (защита от двойного списания)."""
    rows = db.scalars(
        select(PrintJob).where(
            PrintJob.owner_user_id == printer.owner_user_id,
            PrintJob.status == "consumed",
        )
    )
    return {
        pj.file_name.split("/")[-1].strip().lower()
        for pj in rows
        if pj.file_name
    }


def pick_new_jobs(
    jobs: list[dict],
    watermark: float | None,
    imported_ids: set[str],
    consumed_names: set[str],
) -> list[dict]:
    """Новые завершённые задания для импорта (чистая функция — тестируемая)."""
    out = []
    for j in jobs:
        if j.get("status") != "completed":
            continue
        end = j.get("end_time") or 0
        if watermark is not None and end <= watermark:
            continue
        if str(j.get("job_id")) in imported_ids:
            continue
        fn = (j.get("filename") or "").split("/")[-1].strip().lower()
        if fn and fn in consumed_names:
            continue
        out.append(j)
    return out


def resolve_slot_mappings(tools: list[dict], slots: list) -> list[dict] | None:
    """Сопоставление tool_index → слот (slot_index == tool_index + 1, катушка есть).

    tool_index приходит от слайсера/хаба и нумеруется с 0 (это номер гейта),
    а слоты приложения — с 1 (конвенция «gate N ↔ slot_index N+1», см.
    parse_hub и printers.py). Поэтому гейт 0 = слот 1 и т.д.

    Возвращает mappings для confirm_usage или None, если хотя бы один
    инструмент с расходом не сопоставился (тогда оставляем черновик).
    """
    by_index = {s.slot_index: s for s in slots if s.current_spool_id is not None}
    mappings = []
    for t in tools:
        # tool «используется», если есть граммы или хотя бы длина (fallback).
        if float(t.get("used_g") or 0) <= 0 and float(t.get("used_mm") or 0) <= 0:
            continue
        slot = by_index.get(t["tool_index"] + 1)
        if slot is None:
            return None
        mappings.append({"tool_index": t["tool_index"], "slot_id": slot.id})
    return mappings if mappings else None


def poll_printer(db: Session, printer: Printer, *, auto_consume: bool) -> dict:
    """Один цикл опроса принтера. Возвращает статистику для лога."""
    wm_key = f"{WATERMARK_PREFIX}{printer.id}"
    jobs = _client(printer).history_raw(limit=30)
    ends = [j.get("end_time") or 0 for j in jobs]
    newest = max(ends) if ends else 0

    row = db.get(AppSetting, wm_key)
    watermark = row.value.get("value") if row is not None else None

    if watermark is None:
        # Первый запуск: не импортируем историю задним числом.
        settings_service.set_value(db, wm_key, newest)
        return {"printer": printer.name, "initialized": True}

    new_jobs = pick_new_jobs(
        jobs, watermark, _imported_job_ids(db, printer), _consumed_names(db, printer)
    )
    imported = consumed = 0
    owner = db.get(User, printer.owner_user_id)
    slots = list(
        db.scalars(select(PrinterSlot).where(PrinterSlot.printer_id == printer.id))
    )
    for raw in sorted(new_jobs, key=lambda j: j.get("end_time") or 0):
        parsed = job_to_parsed(raw)
        job = print_job_service.create_from_parsed(
            db, owner=owner, printer_id=printer.id, parsed=parsed, source="moonraker"
        )
        imported += 1
        if auto_consume:
            mappings = resolve_slot_mappings(parsed.get("tools", []), slots)
            if mappings:
                try:
                    print_job_service.confirm_usage(
                        db, job, user=owner, mappings=mappings
                    )
                    consumed += 1
                except print_job_service.ConsumptionError as e:
                    log.warning(
                        "auto-consume %s (%s): %s", job.file_name, printer.name, e.problems
                    )
    if newest > watermark:
        settings_service.set_value(db, wm_key, newest)
    return {"printer": printer.name, "imported": imported, "consumed": consumed}


def poll_all(db: Session) -> list[dict]:
    """Опрос всех активных Moonraker-принтеров всех пользователей."""
    if not settings_service.get_bool(db, AUTO_IMPORT_KEY, default=True):
        return []
    auto_consume = settings_service.get_bool(db, AUTO_CONSUME_KEY, default=False)
    printers = list(
        db.scalars(
            select(Printer).where(
                Printer.integration_type == "moonraker",
                Printer.is_active.is_(True),
                Printer.moonraker_url.isnot(None),
            )
        )
    )
    results = []
    for p in printers:
        try:
            res = poll_printer(db, p, auto_consume=auto_consume)
            if res.get("imported") or res.get("initialized"):
                log.info("poll %s", res)
            results.append(res)
        except Exception as e:  # принтер офлайн и т.п. — не валим цикл
            log.debug("poll %s failed: %s", p.name, e)
            results.append({"printer": p.name, "error": str(e)})
    return results
