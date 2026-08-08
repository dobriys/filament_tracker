"""Привязка катушек к слотам принтера с ведением истории.

Инвариант: одна катушка одновременно может быть только в одном слоте.
Каждое назначение/снятие отражается в slot_assignment_history.

Слоты нумеруются с 1 и соответствуют гейтам хаба (gate N ↔ slot_index N+1).
Индекс 0 зарезервирован под ВНЕШНЮЮ КАТУШКУ — держатель сбоку от принтера, с
которого печатают, когда хаб снят. Это отдельное физическое место, а не «слот 1
в другом режиме»: пока они делили одну запись, история назначений не отличала
гейт от держателя, а возврат хаба молча «переставлял» катушку в слот 1.
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

# Внешняя катушка (держатель). Индекс 0 не совпадает ни с одним гейтом — сверка
# со слотами идёт по gate + 1, то есть с единицы.
HOLDER_INDEX = 0
HOLDER_NAME = "Внешняя катушка"


def next_slot_index(db: Session, printer_id) -> int:
    current_max = db.scalar(
        select(func.max(PrinterSlot.slot_index)).where(
            PrinterSlot.printer_id == printer_id
        )
    )
    # Держатель (0) не считается «последним слотом»: следующий после него — 1.
    return max(current_max or 0, 0) + 1


def create_slot(
    db: Session, *, printer_id, slot_index: int | None, name: str | None, is_active: bool
) -> PrinterSlot:
    if slot_index is None:
        slot_index = next_slot_index(db, printer_id)
    slot = PrinterSlot(
        printer_id=printer_id,
        slot_index=slot_index,
        name=name or default_slot_name(slot_index),
        is_active=is_active,
    )
    db.add(slot)
    return slot


def default_slot_name(slot_index: int) -> str:
    return HOLDER_NAME if slot_index == HOLDER_INDEX else f"Slot {slot_index}"


def holder_of(db: Session, printer_id) -> PrinterSlot | None:
    """Слот внешней катушки принтера, если он уже заведён."""
    return db.scalar(
        select(PrinterSlot).where(
            PrinterSlot.printer_id == printer_id,
            PrinterSlot.slot_index == HOLDER_INDEX,
        )
    )


def ensure_holder(db: Session, printer, *, user: User | None = None) -> PrinterSlot:
    """Слот внешней катушки — завести при первой же прямой подаче.

    Заводится только у принтеров с хабом: там «слот 1» двусмыслен. У обычного
    принтера слот 1 и есть держатель, отдельная запись ему не нужна.

    Разовый переезд: до появления держателя катушку с него держали в слоте 1 —
    такова была конвенция. Поэтому при создании держателя катушка из слота 1
    переезжает на него, если он пуст. Иначе после обновления катушка осталась бы
    числиться в гейте снятого хаба, а держатель выглядел бы пустым.
    """
    holder = holder_of(db, printer.id)
    if holder is not None:
        return holder

    holder = create_slot(
        db, printer_id=printer.id, slot_index=HOLDER_INDEX, name=None, is_active=True
    )
    db.flush()

    first = db.scalar(
        select(PrinterSlot).where(
            PrinterSlot.printer_id == printer.id, PrinterSlot.slot_index == 1
        )
    )
    if first is not None and first.current_spool_id is not None:
        spool = db.get(Spool, first.current_spool_id)
        if spool is not None:
            assign_spool(
                db, holder, spool=spool,
                user=user or db.get(User, printer.owner_user_id),
                notes="Перенос со слота 1: печать идёт с внешней катушки",
            )
    db.commit()
    db.refresh(holder)
    return holder


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
