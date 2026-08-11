import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CostEstimateBase(BaseModel):
    name: str
    revision: str | None = None
    notes: str | None = None
    printer_id: uuid.UUID | None = None
    print_job_id: uuid.UUID | None = None
    currency: str = "RUB"


class CostEstimateCreate(CostEstimateBase):
    # Вся форма: граммы, часы, списки комплектующих и упаковки, наценки и
    # тарифы. Если тарифов нет — сервер подставит текущие и заморозит их.
    inputs: dict


class CostEstimateUpdate(BaseModel):
    name: str | None = None
    revision: str | None = None
    notes: str | None = None
    printer_id: uuid.UUID | None = None
    print_job_id: uuid.UUID | None = None
    currency: str | None = None
    inputs: dict | None = None


class CostEstimateListItem(BaseModel):
    """Строка списка — без inputs: в списке нужны итог и подпись, а не вся форма."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    revision: str | None
    printer_id: uuid.UUID | None
    print_job_id: uuid.UUID | None
    currency: str
    landed_cost: float
    created_at: datetime
    updated_at: datetime


class CostEstimateOut(CostEstimateListItem):
    notes: str | None
    inputs: dict
    # Разбор от сервера: материалы, труд, машиночас, упаковка, цены по наценке.
    totals: dict
