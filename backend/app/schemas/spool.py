import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class SpoolBase(BaseModel):
    filament_profile_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    label: str | None = None
    sku: str | None = None
    manufacturer: str | None = None
    barcode: str | None = None
    photo: str | None = None
    material: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    diameter_mm: Decimal | None = None
    hotend_temp: int | None = None
    bed_temp: int | None = None
    fan_speed: int | None = None
    flow_rate: Decimal | None = None
    specs: dict | None = None
    initial_filament_weight_g: Decimal | None = None
    empty_spool_weight_g: Decimal | None = None
    purchase_date: date | None = None
    opened_date: date | None = None
    price: Decimal | None = None
    currency: str = "RUB"
    notes: str | None = None


class SpoolCreate(SpoolBase):
    # Если current_weight_g не передан — берём initial_filament_weight_g
    current_weight_g: Decimal | None = None


class SpoolUpdate(BaseModel):
    filament_profile_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    label: str | None = None
    sku: str | None = None
    manufacturer: str | None = None
    barcode: str | None = None
    photo: str | None = None
    material: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    diameter_mm: Decimal | None = None
    hotend_temp: int | None = None
    bed_temp: int | None = None
    fan_speed: int | None = None
    flow_rate: Decimal | None = None
    specs: dict | None = None
    initial_filament_weight_g: Decimal | None = None
    empty_spool_weight_g: Decimal | None = None
    current_weight_g: Decimal | None = None
    purchase_date: date | None = None
    opened_date: date | None = None
    price: Decimal | None = None
    currency: str | None = None
    status: str | None = None
    notes: str | None = None


class SpoolOut(SpoolBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    current_weight_g: Decimal
    status: str
    qr_token: str
    created_at: datetime
    updated_at: datetime


# --- Операции ---
class WeighRequest(BaseModel):
    # Общий вес катушки (пластик + пустая катушка) по весам
    total_weight_g: Decimal
    reason: str | None = None


class AdjustRequest(BaseModel):
    # Скорректировать остаток. Указывается либо delta, либо new_weight.
    delta_g: Decimal | None = None
    new_weight_g: Decimal | None = None
    reason: str | None = None


class MoveRequest(BaseModel):
    location_id: uuid.UUID | None = None
    reason: str | None = None


class SpoolEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: str
    weight_before_g: Decimal | None
    weight_after_g: Decimal | None
    delta_g: Decimal | None
    reason: str | None
    event_metadata: dict | None
    created_at: datetime
