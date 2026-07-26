import time
import uuid

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret, encrypt_secret
from app.db.session import get_db
from app.deps import get_current_user
from app.models import AppSetting, Printer, PrintJob, User
from app.services.moonraker import MoonrakerClient, dryer_unit
from app.schemas.printer import (
    PrinterCreate,
    PrinterOut,
    PrinterPreset,
    PrinterUpdate,
    TestConnectionResult,
)
from app.schemas.slot import SlotCreate, SlotOut
from app.services import feed_mode, printer_presets, settings_service, slot_service

router = APIRouter(prefix="/printers", tags=["printers"])


def _own(db: Session, user: User, printer_id: uuid.UUID) -> Printer:
    printer = db.get(Printer, printer_id)
    if printer is None or printer.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Принтер не найден")
    return printer


def _to_out(printer: Printer) -> dict:
    return {
        "id": printer.id,
        "owner_user_id": printer.owner_user_id,
        "name": printer.name,
        "integration_type": printer.integration_type,
        "brand": printer.brand,
        "model": printer.model,
        "capabilities": printer.capabilities or {},
        "moonraker_url": printer.moonraker_url,
        "is_active": printer.is_active,
        "notes": printer.notes,
        "has_moonraker_key": bool(printer.moonraker_api_key_encrypted),
        "created_at": printer.created_at,
        "updated_at": printer.updated_at,
    }


@router.get("/presets", response_model=list[PrinterPreset])
def list_presets(user: User = Depends(get_current_user)):
    """Курируемый каталог пресетов принтеров для формы заведения."""
    return printer_presets.PRESETS


@router.get("", response_model=list[PrinterOut])
def list_printers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    printers = db.scalars(
        select(Printer).where(Printer.owner_user_id == user.id).order_by(Printer.name)
    )
    return [_to_out(p) for p in printers]


@router.post("", response_model=PrinterOut, status_code=status.HTTP_201_CREATED)
def create_printer(
    data: PrinterCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Пресет только заполняет умолчания — явные поля запроса всегда важнее.
    preset = printer_presets.get_preset(data.preset_key)
    brand = data.brand
    model = data.model
    capabilities = data.capabilities
    integration_type = data.integration_type
    slot_count = data.slot_count
    if preset is not None:
        brand = brand or preset.get("brand")
        model = model or preset.get("model")
        capabilities = capabilities if capabilities is not None else preset.get("capabilities")
        if not integration_type or integration_type == "manual":
            integration_type = preset.get("integration_type", integration_type)
        if not slot_count:
            slot_count = int((preset.get("capabilities") or {}).get("mmu_slots") or 0)

    printer = Printer(
        owner_user_id=user.id,
        name=data.name,
        integration_type=integration_type,
        brand=brand,
        model=model,
        capabilities=capabilities or {},
        moonraker_url=data.moonraker_url,
        moonraker_api_key_encrypted=(
            encrypt_secret(data.moonraker_api_key) if data.moonraker_api_key else None
        ),
        is_active=data.is_active,
        notes=data.notes,
    )
    db.add(printer)
    db.flush()
    for i in range(1, slot_count + 1):
        slot_service.create_slot(
            db, printer_id=printer.id, slot_index=i, name=None, is_active=True
        )
    db.commit()
    db.refresh(printer)
    return _to_out(printer)


@router.get("/{printer_id}", response_model=PrinterOut)
def get_printer(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _to_out(_own(db, user, printer_id))


@router.patch("/{printer_id}", response_model=PrinterOut)
def update_printer(
    printer_id: uuid.UUID,
    data: PrinterUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    payload = data.model_dump(exclude_unset=True)
    if "moonraker_api_key" in payload:
        key = payload.pop("moonraker_api_key")
        printer.moonraker_api_key_encrypted = encrypt_secret(key) if key else None
    for k, v in payload.items():
        setattr(printer, k, v)
    db.commit()
    db.refresh(printer)
    return _to_out(printer)


@router.delete("/{printer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_printer(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    # Убираем зависимости в строгом порядке (core-запросы выполняются сразу),
    # чтобы не упасть на внешних ключах.
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    from app.models import (
        Printer as PrinterModel,
        PrinterSlot,
        PrintJob,
        PrintJobSpoolUsage,
        SlotAssignmentHistory,
    )

    slot_ids = list(
        db.scalars(select(PrinterSlot.id).where(PrinterSlot.printer_id == printer.id))
    )
    if slot_ids:
        db.execute(
            sa_delete(SlotAssignmentHistory).where(
                SlotAssignmentHistory.printer_slot_id.in_(slot_ids)
            )
        )
        db.execute(
            sa_update(PrintJobSpoolUsage)
            .where(PrintJobSpoolUsage.printer_slot_id.in_(slot_ids))
            .values(printer_slot_id=None)
        )
        db.execute(sa_delete(PrinterSlot).where(PrinterSlot.printer_id == printer.id))
    # Печати оставляем в истории, только отвязываем от принтера.
    db.execute(
        sa_update(PrintJob).where(PrintJob.printer_id == printer.id).values(printer_id=None)
    )
    db.execute(sa_delete(PrinterModel).where(PrinterModel.id == printer.id))
    db.commit()


def _moonraker_client(printer: Printer) -> MoonrakerClient:
    if printer.integration_type != "moonraker" or not printer.moonraker_url:
        raise HTTPException(
            status_code=400, detail="Принтер без интеграции Moonraker"
        )
    api_key = (
        decrypt_secret(printer.moonraker_api_key_encrypted)
        if printer.moonraker_api_key_encrypted
        else None
    )
    return MoonrakerClient(printer.moonraker_url, api_key)


@router.post("/{printer_id}/test-connection", response_model=TestConnectionResult)
def test_connection(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    if printer.integration_type == "manual":
        return TestConnectionResult(ok=True, detail="Ручной принтер — проверка не требуется")
    result = _moonraker_client(printer).test_connection()
    return TestConnectionResult(ok=result["ok"], detail=result["detail"])


@router.get("/{printer_id}/status")
def printer_status(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    try:
        return _moonraker_client(printer).get_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Moonraker недоступен: {e}")


def _annotate_consumption(db: Session, user: User, jobs: list[dict]) -> list[dict]:
    """Помечает задания Moonraker признаком списания.

    - `consumed_via="moonraker"` — по этому заданию уже создано списание из Moonraker;
    - `consumed_via="manual"`    — файл с таким же именем уже списан вручную (из gcode).
    Кнопка «Списать» на фронте выключается, когда `consumed=true`.
    """
    from app.services import print_job_service

    pjs = list(db.scalars(select(PrintJob).where(PrintJob.owner_user_id == user.id)))
    mr_by_id: dict[str, PrintJob] = {}
    consumed_by_name: dict[str, PrintJob] = {}
    for pj in pjs:
        mid = (pj.parsed_metadata or {}).get("moonraker_job_id")
        if pj.source == "moonraker" and mid:
            mr_by_id[str(mid)] = pj
        if pj.status == "consumed" and pj.file_name:
            consumed_by_name[pj.file_name.split("/")[-1].strip().lower()] = pj
    costs = print_job_service.jobs_cost(
        db, [pj.id for pj in pjs if pj.status == "consumed"]
    )
    for j in jobs:
        pj = mr_by_id.get(str(j.get("job_id")))
        via = "moonraker" if (pj is not None and pj.status == "consumed") else None
        cost_pj = pj if via else None
        if via is None:
            fn = (j.get("filename") or "").split("/")[-1].strip().lower()
            if fn and fn in consumed_by_name:
                via = "manual"
                cost_pj = consumed_by_name[fn]
        j["consumed"] = via is not None
        j["consumed_via"] = via
        j["print_job_id"] = str(pj.id) if pj is not None else None
        c = costs.get(cost_pj.id) if cost_pj is not None else None
        j["cost"] = round(c["cost"], 2) if c else None
        j["cost_currency"] = c["currency"] if c else None
        # Слайсер не всегда кладёт вес в метаданные Moonraker (temp-файлы), но
        # при списании граммы посчитались из длины по катушке — показываем их,
        # чтобы «Расход» не был прочерком у уже списанной печати.
        if j.get("filament_total_g") is None and c and c.get("grams"):
            j["filament_total_g"] = round(c["grams"], 2)
    return jobs


@router.get("/{printer_id}/overview")
def printer_overview(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Сводка принтера: статус, гейты ACE-хаба со сверкой со слотами приложения,
    статистика за всю жизнь и служебная информация."""
    from app.models import PrinterSlot, Spool
    from app.services.moonraker import match_gate

    printer = _own(db, user, printer_id)
    client = _moonraker_client(printer)
    try:
        status_data = client.get_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Moonraker недоступен: {e}")

    # гейты хаба + сверка со слотами приложения (gate N ↔ slot_index N+1)
    slots = {
        s.slot_index: s
        for s in db.scalars(
            select(PrinterSlot).where(PrinterSlot.printer_id == printer.id)
        )
    }
    hub = client.get_hub_data()

    # Режим подачи: связь только что подтверждена статусом, так что молчание
    # хаба здесь — довод в пользу прямой подачи (с гистерезисом внутри).
    capabilities = feed_mode.resolve_capabilities(
        db, printer, gates=hub["gates"], dryer=hub["dryer"], online=True,
        mmu_enabled=hub["enabled"],
    )
    if capabilities["feed_mode"] == "direct":
        # Мультиподачи сейчас нет. Гейты и сушилку при этом прячем не «на всякий
        # случай»: отключённый ACE продолжает отдавать и то, и другое — пустые
        # слоты и нулевую сушилку, — и показывать это железо как живое нельзя.
        hub = {"gates": [], "dryer": None}

    gates = []
    for g in hub["gates"]:
        slot = slots.get(g["slot_index"])
        spool = db.get(Spool, slot.current_spool_id) if slot and slot.current_spool_id else None
        g["spool"] = (
            {
                "id": str(spool.id),
                "label": spool.label,
                "material": spool.material,
                "color_hex": spool.color_hex,
                "color_name": spool.color_name,
            }
            if spool
            else None
        )
        g["verdict"] = match_gate(
            g, spool.material if spool else None, spool.color_hex if spool else None
        )
        gates.append(g)

    dryer = hub["dryer"]
    if dryer and dryer.get("status") == "drying" and not dryer.get("remaining_min"):
        # Rinkhals иногда не прокидывает remain_time в mmu_machine. Для сушек,
        # запущенных с сайта, используем сохранённую сессию; для ручных запусков
        # с экрана принтера заводим локальную оценку, если известна duration.
        key = f"dryer_session:{printer.id}"
        row = db.get(AppSetting, key)
        sess = (row.value or {}).get("value") if row is not None else None
        duration_min = int(dryer.get("duration_min") or 0)
        unit = dryer.get("unit")
        target_temp = dryer.get("target_temp")

        if duration_min > 0 and (
            not isinstance(sess, dict)
            or int(sess.get("duration_min") or 0) != duration_min
            or sess.get("unit") != unit
            or sess.get("target_temp") != target_temp
        ):
            sess = {
                "started": time.time(),
                "duration_min": duration_min,
                "unit": unit,
                "target_temp": target_temp,
                "source": "printer",
            }
            settings_service.set_value(db, key, sess)

        if isinstance(sess, dict) and sess.get("started"):
            elapsed_min = (time.time() - sess["started"]) / 60
            dryer["duration_min"] = sess.get("duration_min", duration_min)
            dryer["remaining_min"] = max(0, round(dryer["duration_min"] - elapsed_min))

    return {
        "status": status_data,
        "gates": gates,
        "dryer": dryer,
        "capabilities": capabilities,
        # В прямой подаче слот 1 — та самая катушка с держателя; карточке на
        # панели нечего показать вместо гейтов без неё.
        "direct_slot": (
            _slot_with_spool(db, slots.get(1))
            if capabilities["feed_mode"] == "direct"
            else None
        ),
        "totals": client.get_totals(),
        "system": client.get_system(),
    }


def _slot_with_spool(db: Session, slot) -> dict | None:
    from app.models import Spool

    if slot is None:
        return None
    spool = db.get(Spool, slot.current_spool_id) if slot.current_spool_id else None
    return {
        "id": str(slot.id),
        "slot_index": slot.slot_index,
        "name": slot.name,
        "spool": (
            {
                "id": str(spool.id),
                "label": spool.label,
                "material": spool.material,
                "color_hex": spool.color_hex,
                "color_name": spool.color_name,
                "current_weight_g": float(spool.current_weight_g)
                if spool.current_weight_g is not None
                else None,
            }
            if spool
            else None
        ),
    }


class FeedModeRequest(BaseModel):
    mode: str  # auto | mmu | direct


@router.post("/{printer_id}/feed-mode", response_model=PrinterOut)
def set_feed_mode(
    printer_id: uuid.UUID,
    data: FeedModeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Переключить режим подачи: авто / мультиподача / прямая одна катушка."""
    printer = _own(db, user, printer_id)
    try:
        feed_mode.set_mode(db, printer, data.mode)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _to_out(printer)


class DryerRequest(BaseModel):
    action: str  # "start" | "stop"
    temp_c: int | None = None
    duration_min: int | None = None
    unit: int | None = None


@router.post("/{printer_id}/dryer")
def control_dryer(
    printer_id: uuid.UUID,
    data: DryerRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Включить/выключить сушку ACE (Rinkhals filament_hub API)."""
    printer = _own(db, user, printer_id)
    client = _moonraker_client(printer)
    try:
        if data.unit is not None and data.unit < 0:
            raise HTTPException(status_code=422, detail="Неизвестное действие")
        if data.action == "start":
            if not data.temp_c or not data.duration_min:
                raise HTTPException(status_code=422, detail="Укажите температуру и время сушки")
            if not (35 <= data.temp_c <= 70):
                raise HTTPException(status_code=422, detail="Температура сушки: 35–70°C")
            if not (1 <= data.duration_min <= 24 * 60):
                raise HTTPException(status_code=422, detail="Время сушки: от 1 минуты до 24 часов")
            dryer = client.get_hub_data()["dryer"]
            unit = dryer_unit(dryer, data.unit)
            client.start_drying(temp_c=data.temp_c, duration_min=data.duration_min, unit=unit)
            settings_service.set_value(
                db,
                f"dryer_session:{printer.id}",
                {"started": time.time(), "duration_min": data.duration_min, "unit": unit},
            )
        elif data.action == "stop":
            dryer = client.get_hub_data()["dryer"]
            client.stop_drying(unit=dryer_unit(dryer, data.unit))
            settings_service.set_value(db, f"dryer_session:{printer.id}", None)
        else:
            raise HTTPException(status_code=422, detail="Неизвестное действие")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Moonraker недоступен: {e}")
    return {"ok": True, "dryer": client.get_hub_data()["dryer"]}


@router.post("/{printer_id}/reset-error")
def reset_printer_error(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Сбросить защёлкнутую ошибку прошлой печати на принтере (SDCARD_RESET_FILE).

    print_stats.state=error держится до старта новой печати, из-за чего решённая
    ошибка продолжает висеть в виджете. Команда возвращает состояние в standby.
    """
    printer = _own(db, user, printer_id)
    client = _moonraker_client(printer)
    try:
        client.reset_print_state()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Moonraker недоступен: {e}")
    return {"ok": True, "status": client.get_status()}


@router.get("/{printer_id}/moonraker-jobs")
def moonraker_jobs(
    printer_id: uuid.UUID,
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    try:
        jobs = _moonraker_client(printer).list_history(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Moonraker недоступен: {e}")
    return _annotate_consumption(db, user, jobs)


@router.post("/{printer_id}/moonraker-jobs/{job_id}/import")
def import_moonraker_job(
    printer_id: uuid.UUID,
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Создаёт черновик print job из задания Moonraker (для списания).

    Идемпотентно: повторный импорт того же задания возвращает существующую печать,
    чтобы не плодить дубли-черновики и не списать один расход дважды.
    """
    from app.services import moonraker, print_job_service

    printer = _own(db, user, printer_id)
    existing = db.scalar(
        select(PrintJob).where(
            PrintJob.owner_user_id == user.id,
            PrintJob.source == "moonraker",
            PrintJob.parsed_metadata["moonraker_job_id"].astext == str(job_id),
        )
    )
    if existing is not None:
        return {"print_job_id": str(existing.id), "status": existing.status}
    try:
        jobs = _moonraker_client(printer).history_raw(limit=100)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Moonraker недоступен: {e}")
    raw = next((j for j in jobs if str(j.get("job_id")) == job_id), None)
    if raw is None:
        raise HTTPException(status_code=404, detail="Задание не найдено в истории Moonraker")
    parsed = moonraker.job_to_parsed(raw)
    job = print_job_service.create_from_parsed(
        db, owner=user, printer_id=printer.id, parsed=parsed, source="moonraker"
    )
    return {"print_job_id": str(job.id), "status": job.status}


# --- Слоты в контексте принтера ---
@router.get("/{printer_id}/slots", response_model=list[SlotOut])
def list_slots(
    printer_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    from app.models import PrinterSlot

    slots = db.scalars(
        select(PrinterSlot)
        .where(PrinterSlot.printer_id == printer.id)
        .order_by(PrinterSlot.slot_index)
    )
    return [slot_service.slot_to_out(db, s) for s in slots]


@router.post("/{printer_id}/slots", response_model=SlotOut, status_code=status.HTTP_201_CREATED)
def create_slot(
    printer_id: uuid.UUID,
    data: SlotCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    printer = _own(db, user, printer_id)
    from app.models import PrinterSlot

    if data.slot_index is not None:
        exists = db.scalar(
            select(PrinterSlot).where(
                PrinterSlot.printer_id == printer.id,
                PrinterSlot.slot_index == data.slot_index,
            )
        )
        if exists:
            raise HTTPException(status_code=409, detail="Слот с таким номером уже есть")
    slot = slot_service.create_slot(
        db,
        printer_id=printer.id,
        slot_index=data.slot_index,
        name=data.name,
        is_active=data.is_active,
    )
    db.commit()
    db.refresh(slot)
    return slot_service.slot_to_out(db, slot)
