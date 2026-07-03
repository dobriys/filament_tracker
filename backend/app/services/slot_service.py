"""Привязка катушек к слотам принтера с ведением истории.

Инвариант: одна катушка одновременно может быть только в одном слоте.
Каждое назначение/снятие отражается в slot_assignment_history.
"""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    PrinterSlot,
    SlotAssignmentHistory,
    Spool,
    User,
)


def next_slot_index(db: Session, printer_id) -> int:
    current_max = db.scalar(
        select(func.max(PrinterSlot.slot_index)).where(
            PrinterSlot.printer_id == printer_id
        )
    )
    return (current_max or 0) + 1


def create_slot(
    db: Session, *, printer_id, slot_index: int | None, name: str | None, is_active: bool
) -> PrinterSlot:
    if slot_index is None:
        slot_index = next_slot_index(db, printer_id)
    slot = PrinterSlot(
        printer_id=printer_id,
        slot_index=slot_index,
        name=name or f"Slot {slot_index}",
        is_active=is_active,
    )
    db.add(slot)
    return slot


def _close_open_history(db: Session, slot_id) -> None:
    open_rows = db.scalars(
        select(SlotAssignmentHistory).where(
            SlotAssignmentHistory.printer_slot_id == slot_id,
            SlotAssignmentHistory.unassigned_at.is_(None),
        )
    )
    now = datetime.now(timezone.utc)
    for row in open_rows:
        row.unassigned_at = now


def assign_spool(
    db: Session, slot: PrinterSlot, *, spool: Spool, user: User, notes=None
) -> PrinterSlot:
    # Снять катушку с любого другого слота, где она сейчас стоит.
    other_slots = db.scalars(
        select(PrinterSlot).where(
            PrinterSlot.current_spool_id == spool.id,
            PrinterSlot.id != slot.id,
        )
    )
    for other in other_slots:
        _close_open_history(db, other.id)
        other.current_spool_id = None

    # Закрыть текущую запись истории целевого слота (если в нём была катушка).
    if slot.current_spool_id is not None:
        _close_open_history(db, slot.id)

    slot.current_spool_id = spool.id
    db.add(
        SlotAssignmentHistory(
            printer_slot_id=slot.id,
            spool_id=spool.id,
            user_id=user.id,
            notes=notes,
        )
    )
    db.commit()
    db.refresh(slot)
    return slot


def unassign_spool(db: Session, slot: PrinterSlot, *, user: User) -> PrinterSlot:
    if slot.current_spool_id is not None:
        _close_open_history(db, slot.id)
        slot.current_spool_id = None
        db.commit()
        db.refresh(slot)
    return slot


def slot_to_out(db: Session, slot: PrinterSlot) -> dict:
    """Готовит словарь для SlotOut с подписью текущей катушки."""
    label = None
    if slot.current_spool_id is not None:
        spool = db.get(Spool, slot.current_spool_id)
        if spool is not None:
            label = spool.label or "Без метки"
    return {
        "id": slot.id,
        "printer_id": slot.printer_id,
        "slot_index": slot.slot_index,
        "name": slot.name,
        "current_spool_id": slot.current_spool_id,
        "is_active": slot.is_active,
        "current_spool_label": label,
    }
