import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class FilamentProfileBase(BaseModel):
    brand: str | None = None
    name: str
    material: str
    color_name: str | None = None
    color_hex: str | None = None
    diameter_mm: Decimal | None = Decimal("1.75")
    density_g_cm3: Decimal | None = None
    nozzle_temp_min: int | None = None
    nozzle_temp_max: int | None = None
    bed_temp_min: int | None = None
    bed_temp_max: int | None = None
    flow_ratio: Decimal | None = None
    pressure_advance: Decimal | None = None
    fan_percent: int | None = None
    print_speed_mm_s: int | None = None
    max_volumetric_speed: Decimal | None = None
    notes: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    is_public: bool = False
    specs: dict | None = None


class FilamentProfileCreate(FilamentProfileBase):
    pass


class FilamentProfileUpdate(BaseModel):
    brand: str | None = None
    name: str | None = None
    material: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    diameter_mm: Decimal | None = None
    density_g_cm3: Decimal | None = None
    nozzle_temp_min: int | None = None
    nozzle_temp_max: int | None = None
    bed_temp_min: int | None = None
    bed_temp_max: int | None = None
    flow_ratio: Decimal | None = None
    pressure_advance: Decimal | None = None
    fan_percent: int | None = None
    print_speed_mm_s: int | None = None
    max_volumetric_speed: Decimal | None = None
    notes: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    is_public: bool | None = None
    specs: dict | None = None


class FilamentProfileOut(FilamentProfileBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
