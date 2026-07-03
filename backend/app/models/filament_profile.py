import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, gen_uuid


class FilamentProfile(Base, TimestampMixin):
    __tablename__ = "filament_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )

    brand: Mapped[str | None] = mapped_column(String)
    name: Mapped[str] = mapped_column(String, nullable=False)
    material: Mapped[str] = mapped_column(String, nullable=False)
    color_name: Mapped[str | None] = mapped_column(String)
    color_hex: Mapped[str | None] = mapped_column(String)

    diameter_mm: Mapped[float] = mapped_column(Numeric(5, 2), default=1.75)
    density_g_cm3: Mapped[float | None] = mapped_column(Numeric(6, 3))

    nozzle_temp_min: Mapped[int | None] = mapped_column(Integer)
    nozzle_temp_max: Mapped[int | None] = mapped_column(Integer)
    bed_temp_min: Mapped[int | None] = mapped_column(Integer)
    bed_temp_max: Mapped[int | None] = mapped_column(Integer)

    flow_ratio: Mapped[float | None] = mapped_column(Numeric(6, 3))
    pressure_advance: Mapped[float | None] = mapped_column(Numeric(8, 5))
    fan_percent: Mapped[int | None] = mapped_column(Integer)
    print_speed_mm_s: Mapped[int | None] = mapped_column(Integer)
    max_volumetric_speed: Mapped[float | None] = mapped_column(Numeric(6, 2))

    notes: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(String)
    source_url: Mapped[str | None] = mapped_column(String)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Расширенные характеристики (та же схема specFields, что и у катушки).
    specs: Mapped[dict | None] = mapped_column(JSONB)
