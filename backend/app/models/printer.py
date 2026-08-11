import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, gen_uuid


class Printer(Base, TimestampMixin):
    __tablename__ = "printers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    integration_type: Mapped[str] = mapped_column(
        String, nullable=False, default="manual"
    )
    # Бренд/модель — для брендинга и пресетов; capabilities — что умеет принтер
    # (has_mmu, mmu_slots, has_dryer, tool_count…) и драйвер визуала карточки.
    brand: Mapped[str | None] = mapped_column(String)
    model: Mapped[str | None] = mapped_column(String)
    capabilities: Mapped[dict | None] = mapped_column(JSONB)
    # Деньги на час работы: мощность, цена, срок службы, загрузка (см.
    # cost_service.PRINTER_KEYS). Отдельно от capabilities намеренно — тот
    # словарь рисует карточку принтера, и тарифы протекли бы в чипы.
    # Пустое поле означает «как в общих настройках», поэтому колонка nullable.
    cost_params: Mapped[dict | None] = mapped_column(JSONB)
    moonraker_url: Mapped[str | None] = mapped_column(String)
    moonraker_api_key_encrypted: Mapped[str | None] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text)


class PrinterSlot(Base, TimestampMixin):
    __tablename__ = "printer_slots"
    __table_args__ = (UniqueConstraint("printer_id", "slot_index"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    printer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("printers.id"), nullable=False
    )
    slot_index: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(String)
    current_spool_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("spools.id")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class SlotAssignmentHistory(Base):
    __tablename__ = "slot_assignment_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    printer_slot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("printer_slots.id"), nullable=False
    )
    spool_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("spools.id")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    unassigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
