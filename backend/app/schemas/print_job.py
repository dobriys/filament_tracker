import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# --- Результат парсинга gcode ---
class ToolParsed(BaseModel):
    tool_index: int
    material: str | None = None
    color_hex: str | None = None
    used_g: float | None = None
    used_mm: float | None = None
    density_g_cm3: float | None = None


class GcodeParseResult(BaseModel):
    file_name: str | None = None
    file_hash: str | None = None
    slicer_name: str | None = None
    slicer_version: str | None = None
    diameter_mm: float | None = None
    estimated_print_time_sec: int | None = None
    filament_change_count: int | None = None
    tool_count: int = 0
    total_filament_used_g: float | None = None
    total_filament_used_mm: float | None = None
    tools: list[ToolParsed] = []


# --- Печати ---
class PrintJobCreate(BaseModel):
    printer_id: uuid.UUID | None = None
    parsed: GcodeParseResult


class ToolUsageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tool_index: int
    slot_index: int | None
    material: str | None
    color_hex: str | None
    used_g: Decimal | None
    used_mm: Decimal | None


class SpoolUsageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    spool_id: uuid.UUID
    printer_slot_id: uuid.UUID | None
    tool_index: int | None
    used_g: Decimal
    confirmed_at: datetime | None


class PrintJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    printer_id: uuid.UUID | None
    source: str
    file_name: str | None
    slicer_name: str | None
    slicer_version: str | None
    estimated_print_time_sec: int | None
    filament_change_count: int | None
    total_filament_used_g: Decimal | None
    total_filament_used_mm: Decimal | None
    # Фактически списано с катушек. У слайсерского итога граммов может не быть
    # (временные .3mf, оборванная печать) — тогда это единственный точный вес.
    consumed_g: float | None = None
    status: str
    created_at: datetime
    completed_at: datetime | None
    # Себестоимость по списанным катушкам (есть только если у катушки задана цена)
    cost: float | None = None
    cost_currency: str | None = None
    cost_partial: bool = False  # часть катушек без цены — итог занижен
    failed: bool = False        # печать отмечена как брак


class PrintJobDetailOut(PrintJobOut):
    tools: list[ToolUsageOut] = []
    spool_usage: list[SpoolUsageOut] = []


class ToolSlotMapping(BaseModel):
    tool_index: int
    # Можно привязать инструмент либо к слоту (берётся его катушка),
    # либо напрямую к катушке из инвентаря.
    slot_id: uuid.UUID | None = None
    spool_id: uuid.UUID | None = None


class ConfirmUsageRequest(BaseModel):
    mappings: list[ToolSlotMapping]
    allow_negative: bool = False
