import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PrinterBase(BaseModel):
    name: str
    integration_type: str = "manual"  # manual | moonraker
    moonraker_url: str | None = None
    is_active: bool = True
    notes: str | None = None


class PrinterCreate(PrinterBase):
    moonraker_api_key: str | None = None
    # Удобство: сразу создать N слотов (Slot 1..N) при создании принтера.
    slot_count: int = 0


class PrinterUpdate(BaseModel):
    name: str | None = None
    integration_type: str | None = None
    moonraker_url: str | None = None
    moonraker_api_key: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class PrinterOut(PrinterBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    has_moonraker_key: bool
    created_at: datetime
    updated_at: datetime


class TestConnectionResult(BaseModel):
    ok: bool
    detail: str
