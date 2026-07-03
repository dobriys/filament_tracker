import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SlotCreate(BaseModel):
    # slot_index можно не задавать — будет следующий свободный.
    slot_index: int | None = None
    name: str | None = None
    is_active: bool = True


class SlotUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class SlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    printer_id: uuid.UUID
    slot_index: int
    name: str | None
    current_spool_id: uuid.UUID | None
    is_active: bool
    # Обогащение для UI — что сейчас в слоте.
    current_spool_label: str | None = None


class AssignSpoolRequest(BaseModel):
    spool_id: uuid.UUID
    notes: str | None = None


class SlotAssignmentHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    printer_slot_id: uuid.UUID
    spool_id: uuid.UUID | None
    user_id: uuid.UUID | None
    assigned_at: datetime
    unassigned_at: datetime | None
    notes: str | None
