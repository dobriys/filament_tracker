import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PrinterBase(BaseModel):
    name: str
    integration_type: str = "manual"  # manual | moonraker
    brand: str | None = None
    model: str | None = None
    capabilities: dict | None = None
    # Тарифы этого принтера для расчёта себестоимости; пустое поле — «как в
    # общих настройках» (см. cost_service.resolve_rates).
    cost_params: dict | None = None
    moonraker_url: str | None = None
    is_active: bool = True
    notes: str | None = None


class PrinterCreate(PrinterBase):
    moonraker_api_key: str | None = None
    # Пресет из каталога — префилл бренда/модели/интеграции/возможностей/слотов.
    preset_key: str | None = None
    # Удобство: сразу создать N слотов (Slot 1..N) при создании принтера.
    slot_count: int = 0


class PrinterUpdate(BaseModel):
    name: str | None = None
    integration_type: str | None = None
    brand: str | None = None
    model: str | None = None
    capabilities: dict | None = None
    cost_params: dict | None = None
    moonraker_url: str | None = None
    moonraker_api_key: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class PrinterOut(PrinterBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    has_moonraker_key: bool
    # Наблюдение за железом: {mode, prev, changed_at, confirmed} — см. feed_mode.
    # None, пока принтер ни разу не опрашивали.
    feed_state: dict | None = None
    created_at: datetime
    updated_at: datetime


class PrinterPreset(BaseModel):
    key: str
    brand: str | None = None
    model: str | None = None
    integration_type: str
    capabilities: dict
    note: str | None = None


class TestConnectionResult(BaseModel):
    ok: bool
    detail: str
