"""Создание печатей из распарсенного gcode и списание по слотам.

Логика списания (раздел 7 ТЗ):
  print_job_tool_usage -> по tool_index найти slot -> текущая катушка слота ->
  проверить остаток -> создать print_job_spool_usage -> уменьшить вес ->
  записать spool_event(print_usage).
"""
import math
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    FilamentProfile,
    PrinterSlot,
    PrintJob,
    PrintJobSpoolUsage,
    PrintJobToolUsage,
    Spool,
    User,
)
from app.services import notifications, settings_service, spool_service


class ConsumptionError(Exception):
    def __init__(self, problems: list[dict]):
        self.problems = problems
        super().__init__("Невозможно списать печать")


# Плотность филамента, г/см³ — для оценки веса по длине, когда слайсер не отдал
# пофиловый расход в граммах. Значения ориентировочные, по материалу катушки.
_DEFAULT_DENSITY = {
    "PLA": 1.24, "PLA+": 1.24, "PETG": 1.27, "PET": 1.27, "ABS": 1.04,
    "ASA": 1.07, "TPU": 1.21, "TPE": 1.21, "PC": 1.20, "NYLON": 1.14,
    "PA": 1.14, "HIPS": 1.04, "PVA": 1.23, "PP": 0.90,
}


def _spool_density(db: Session, spool: Spool) -> float:
    if spool.filament_profile_id:
        prof = db.get(FilamentProfile, spool.filament_profile_id)
        if prof is not None and prof.density_g_cm3:
            return float(prof.density_g_cm3)
    mat = (spool.material or "").upper().replace(" ", "")
    return _DEFAULT_DENSITY.get(mat) or _DEFAULT_DENSITY.get(mat.rstrip("+")) or 1.24


def grams_from_length(db: Session, spool: Spool, length_mm) -> Decimal:
    """Вес филамента по длине: π·(d/2)²·L / 1000 · плотность (мм³ → см³ → г)."""
    d = float(spool.diameter_mm or 1.75)
    grams = math.pi * (d / 2) ** 2 * float(length_mm) / 1000 * _spool_density(db, spool)
    return Decimal(str(round(grams, 2)))


def create_from_parsed(
    db: Session, *, owner: User, printer_id, parsed: dict, source: str = "manual_upload"
) -> PrintJob:
    job = PrintJob(
        owner_user_id=owner.id,
        printer_id=printer_id,
        source=source,
        file_name=parsed.get("file_name"),
        file_hash=parsed.get("file_hash"),
        slicer_name=parsed.get("slicer_name"),
        slicer_version=parsed.get("slicer_version"),
        estimated_print_time_sec=parsed.get("estimated_print_time_sec"),
        filament_change_count=parsed.get("filament_change_count"),
        total_filament_used_g=parsed.get("total_filament_used_g"),
        total_filament_used_mm=parsed.get("total_filament_used_mm"),
        status="draft",
        parsed_metadata={
            k: parsed.get(k)
            for k in ("slicer_name", "diameter_mm", "tool_count", "moonraker_job_id")
        },
    )
    db.add(job)
    db.flush()

    for t in parsed.get("tools", []):
        db.add(
            PrintJobToolUsage(
                print_job_id=job.id,
                tool_index=t["tool_index"],
                slot_index=None,
                material=t.get("material"),
                color_hex=t.get("color_hex"),
                used_g=t.get("used_g"),
                used_mm=t.get("used_mm"),
                parsed_metadata={"density_g_cm3": t.get("density_g_cm3")},
            )
        )
    db.commit()
    db.refresh(job)
    return job


def jobs_consumed_g(db: Session, job_ids: list) -> dict:
    """Фактически списанный вес по печатям: {job_id: граммы}.

    Отдельно от jobs_cost: там записи без цены отбрасываются целиком, а вес
    известен всегда — он и есть самый точный ответ на вопрос «сколько ушло».
    """
    if not job_ids:
        return {}
    rows = db.execute(
        select(
            PrintJobSpoolUsage.print_job_id,
            func.sum(PrintJobSpoolUsage.used_g),
        )
        .where(PrintJobSpoolUsage.print_job_id.in_(job_ids))
        .group_by(PrintJobSpoolUsage.print_job_id)
    ).all()
    return {jid: float(total) for jid, total in rows if total is not None}


def jobs_cost(db: Session, job_ids: list) -> dict:
    """Себестоимость печатей по фактическим списаниям.

    Цена за грамм берётся из spool_service.price_per_gram (учитывает вес
    катушки на момент заведения — початая катушка не занижает итог).
    Возвращает {job_id: {cost, currency, partial, grams}}, где partial=True —
    часть списаний была с катушек без цены (итог занижен); grams — суммарный
    фактически списанный вес по всем катушкам печати.
    """
    if not job_ids:
        return {}
    rows = db.execute(
        select(
            PrintJobSpoolUsage.print_job_id,
            PrintJobSpoolUsage.spool_id,
            PrintJobSpoolUsage.used_g,
        ).where(PrintJobSpoolUsage.print_job_id.in_(job_ids))
    ).all()
    ppg = spool_service.price_per_gram(db, list({r[1] for r in rows}))
    out: dict = {}
    for jid, spool_id, used_g in rows:
        entry = out.setdefault(
            jid, {"cost": 0.0, "currency": None, "partial": False, "grams": 0.0}
        )
        entry["grams"] += float(used_g)
        p = ppg.get(spool_id)
        if p is None:
            entry["partial"] = True
            continue
        entry["cost"] += float(used_g) * p[0]
        entry["currency"] = entry["currency"] or p[1]
    # печати, где ни одной катушки с ценой, — цены нет вовсе
    return {k: v for k, v in out.items() if v["currency"] is not None}


def tool_usage(db: Session, job: PrintJob) -> list[PrintJobToolUsage]:
    return list(
        db.scalars(
            select(PrintJobToolUsage)
            .where(PrintJobToolUsage.print_job_id == job.id)
            .order_by(PrintJobToolUsage.tool_index)
        )
    )


def confirm_usage(
    db: Session,
    job: PrintJob,
    *,
    user: User,
    mappings: list[dict],  # [{tool_index, slot_id}]
    allow_negative_requested: bool = False,
) -> PrintJob:
    if job.status not in ("draft", "ready_to_consume"):
        raise ConsumptionError(
            [{"detail": f"Печать в статусе '{job.status}' нельзя списать"}]
        )

    map_by_tool = {m["tool_index"]: m for m in mappings}
    allow_negative = allow_negative_requested and (
        user.role == "admin" or settings_service.get_bool(db, settings_service.ALLOW_NEGATIVE_KEY)
    )

    rows = tool_usage(db, job)
    plan = []  # (tool_row, slot, spool, used_g)
    problems = []

    for row in rows:
        has_g = Decimal(row.used_g or 0) > 0
        has_mm = Decimal(row.used_mm or 0) > 0
        if not has_g and not has_mm:
            continue
        m = map_by_tool.get(row.tool_index)
        spool_id = m.get("spool_id") if m else None
        slot_id = m.get("slot_id") if m else None
        slot = None
        spool = None
        if spool_id:
            # прямая привязка к катушке из инвентаря
            spool = db.get(Spool, spool_id)
            if spool is None or spool.owner_user_id != user.id:
                problems.append({"tool_index": row.tool_index, "detail": "Катушка не найдена"})
                continue
            if slot_id:
                slot = db.get(PrinterSlot, slot_id)
        elif slot_id:
            slot = db.get(PrinterSlot, slot_id)
            if slot is None or slot.current_spool_id is None:
                problems.append({"tool_index": row.tool_index, "detail": "В слоте нет катушки"})
                continue
            spool = db.get(Spool, slot.current_spool_id)
        else:
            problems.append({"tool_index": row.tool_index, "detail": "Не выбран филамент"})
            continue
        # Нет пофиловых граммов — считаем из длины по выбранной катушке.
        used = Decimal(row.used_g or 0)
        if used <= 0 and has_mm:
            used = grams_from_length(db, spool, row.used_mm)
        if used <= 0:
            continue
        left = Decimal(spool.current_weight_g)
        if left < used and not allow_negative:
            problems.append(
                {
                    "tool_index": row.tool_index,
                    "detail": "Недостаточно остатка",
                    "needed_g": float(used),
                    "available_g": float(left),
                }
            )
            continue
        plan.append((row, slot, spool, used, left))

    if problems:
        raise ConsumptionError(problems)

    now = datetime.now(timezone.utc)
    for row, slot, spool, used, _before in plan:
        row.slot_index = slot.slot_index if slot else None
        spool_service.consume(
            db,
            spool,
            used_g=used,
            user=user,
            reason=f"Печать {job.file_name or job.id}",
            metadata={"print_job_id": str(job.id), "tool_index": row.tool_index},
            commit=False,
        )
        db.add(
            PrintJobSpoolUsage(
                print_job_id=job.id,
                spool_id=spool.id,
                printer_slot_id=slot.id if slot else None,
                tool_index=row.tool_index,
                used_g=used,
                used_mm=row.used_mm,
                confirmed_by_user_id=user.id,
                confirmed_at=now,
            )
        )

    job.status = "consumed"
    job.completed_at = now
    db.commit()
    db.refresh(job)
    _notify_low_spools(db, [(spool, before) for _, _, spool, _, before in plan])
    return job


def _notify_low_spools(db: Session, spools: list[tuple]) -> None:
    """Уведомление «катушка заканчивается» — только в момент пересечения порога.

    Сравниваем остаток до и после списания: без этого одно и то же уведомление
    приходило бы после каждой следующей печати с той же катушки.
    """
    cfg = settings_service.low_config(db)
    for spool, before in spools:
        # Порог свой у каждой катушки: он считается от её ёмкости, иначе
        # пробник 250 г и бухта 3 кг предупреждали бы в один и тот же момент.
        threshold = Decimal(str(
            settings_service.low_threshold_for(spool.initial_filament_weight_g, cfg)
        ))
        after = Decimal(spool.current_weight_g)
        if before > threshold >= after:
            title = spool.label or f"{spool.material or ''} {spool.color_name or ''}".strip()
            notifications.notify(
                db, "spool_low",
                f"🪫 <b>Катушка заканчивается</b>\n"
                f"{notifications.esc(title or spool.id)}\n"
                f"Остаток: {after:.0f} г",
            )


def cancel(db: Session, job: PrintJob) -> PrintJob:
    if job.status == "consumed":
        raise ConsumptionError([{"detail": "Списанную печать нельзя отменить"}])
    job.status = "cancelled"
    db.commit()
    db.refresh(job)
    return job
