import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, gen_uuid


class Spool(Base, TimestampMixin):
    __tablename__ = "spools"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    filament_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("filament_profiles.id")
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id")
    )

    label: Mapped[str | None] = mapped_column(String)  # Spool Name
    sku: Mapped[str | None] = mapped_column(String)
    manufacturer: Mapped[str | None] = mapped_column(String)
    barcode: Mapped[str | None] = mapped_column(String)
    photo: Mapped[str | None] = mapped_column(Text)  # data URL

    # Характеристики материала на уровне катушки (приоритет над профилем).
    material: Mapped[str | None] = mapped_column(String)
    color_name: Mapped[str | None] = mapped_column(String)
    color_hex: Mapped[str | None] = mapped_column(String)
    diameter_mm: Mapped[float | None] = mapped_column(Numeric(5, 2))

    # Переопределения настроек печати для конкретной катушки.
    hotend_temp: Mapped[int | None] = mapped_column(Integer)
    bed_temp: Mapped[int | None] = mapped_column(Integer)
    fan_speed: Mapped[int | None] = mapped_column(Integer)
    flow_rate: Mapped[float | None] = mapped_column(Numeric(6, 2))

    # Расширенные технические характеристики филамента (см. specFields на фронте).
    specs: Mapped[dict | None] = mapped_column(JSONB)

    initial_filament_weight_g: Mapped[float | None] = mapped_column(Numeric(10, 2))
    empty_spool_weight_g: Mapped[float | None] = mapped_column(Numeric(10, 2))
    current_weight_g: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    purchase_date: Mapped[date | None] = mapped_column(Date)
    opened_date: Mapped[date | None] = mapped_column(Date)
    price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String, default="RUB")

    status: Mapped[str] = mapped_column(String, nullable=False, default="new")
    qr_token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


class SpoolEvent(Base):
    __tablename__ = "spool_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    spool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("spools.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )

    # created | manual_adjustment | weighed | print_usage | moved | archived
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    weight_before_g: Mapped[float | None] = mapped_column(Numeric(10, 2))
    weight_after_g: Mapped[float | None] = mapped_column(Numeric(10, 2))
    delta_g: Mapped[float | None] = mapped_column(Numeric(10, 2))

    reason: Mapped[str | None] = mapped_column(Text)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
