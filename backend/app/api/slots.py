import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import Printer, PrinterSlot, SlotAssignmentHistory, Spool, User
from app.schemas.slot import (
    AssignSpoolRequest,
    SlotAssignmentHistoryOut,
    SlotOut,
    SlotUpdate,
)
from app.services import slot_service

router = APIRouter(prefix="/slots", tags=["slots"])


def _own_slot(db: Session, user: User, slot_id: uuid.UUID) -> PrinterSlot:
    slot = db.get(PrinterSlot, slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Слот не найден")
    printer = db.get(Printer, slot.printer_id)
    if printer is None or printer.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Слот не найден")
    return slot


@router.patch("/{slot_id}", response_model=SlotOut)
def update_slot(
    slot_id: uuid.UUID,
    data: SlotUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    slot = _own_slot(db, user, slot_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(slot, k, v)
    db.commit()
    db.refresh(slot)
    return slot_service.slot_to_out(db, slot)


@router.delete("/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_slot(
    slot_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    slot = _own_slot(db, user, slot_id)
    db.delete(slot)
    db.commit()


@router.post("/{slot_id}/assign-spool", response_model=SlotOut)
def assign_spool(
    slot_id: uuid.UUID,
    data: AssignSpoolRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    slot = _own_slot(db, user, slot_id)
    spool = db.get(Spool, data.spool_id)
    if spool is None or spool.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Катушка не найдена")
    slot = slot_service.assign_spool(db, slot, spool=spool, user=user, notes=data.notes)
    return slot_service.slot_to_out(db, slot)


@router.post("/{slot_id}/unassign-spool", response_model=SlotOut)
def unassign_spool(
    slot_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    slot = _own_slot(db, user, slot_id)
    slot = slot_service.unassign_spool(db, slot, user=user)
    return slot_service.slot_to_out(db, slot)


@router.get("/{slot_id}/history", response_model=list[SlotAssignmentHistoryOut])
def slot_history(
    slot_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _own_slot(db, user, slot_id)
    return list(
        db.scalars(
            select(SlotAssignmentHistory)
            .where(SlotAssignmentHistory.printer_slot_id == slot_id)
            .order_by(SlotAssignmentHistory.assigned_at.desc())
        )
    )
