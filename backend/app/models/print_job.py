import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, gen_uuid


class PrintJob(Base, TimestampMixin):
    __tablename__ = "print_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    printer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("printers.id")
    )

    source: Mapped[str] = mapped_column(String, nullable=False, default="manual_upload")
    file_name: Mapped[str | None] = mapped_column(String)
    file_hash: Mapped[str | None] = mapped_column(String)

    slicer_name: Mapped[str | None] = mapped_column(String)
    slicer_version: Mapped[str | None] = mapped_column(String)

    estimated_print_time_sec: Mapped[int | None] = mapped_column(Integer)
    filament_change_count: Mapped[int | None] = mapped_column(Integer)
    total_filament_used_g: Mapped[float | None] = mapped_column(Numeric(10, 2))
    total_filament_used_mm: Mapped[float | None] = mapped_column(Numeric(12, 2))

    # draft | ready_to_consume | consumed | cancelled | error | archived
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    parsed_metadata: Mapped[dict | None] = mapped_column(JSONB)

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PrintJobToolUsage(Base):
    __tablename__ = "print_job_tool_usage"
    __table_args__ = (UniqueConstraint("print_job_id", "tool_index"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    print_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("print_jobs.id"), nullable=False
    )
    tool_index: Mapped[int] = mapped_column(Integer, nullable=False)
    slot_index: Mapped[int | None] = mapped_column(Integer)
    material: Mapped[str | None] = mapped_column(String)
    color_hex: Mapped[str | None] = mapped_column(String)
    used_g: Mapped[float | None] = mapped_column(Numeric(10, 2))
    used_mm: Mapped[float | None] = mapped_column(Numeric(12, 2))
    parsed_metadata: Mapped[dict | None] = mapped_column(JSONB)


class PrintJobSpoolUsage(Base):
    __tablename__ = "print_job_spool_usage"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=gen_uuid
    )
    print_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("print_jobs.id"), nullable=False
    )
    spool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("spools.id"), nullable=False
    )
    printer_slot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("printer_slots.id")
    )
    tool_index: Mapped[int | None] = mapped_column(Integer)
    used_g: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    used_mm: Mapped[float | None] = mapped_column(Numeric(12, 2))

    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
