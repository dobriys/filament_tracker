"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="user"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "filament_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("brand", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("material", sa.String(), nullable=False),
        sa.Column("color_name", sa.String(), nullable=True),
        sa.Column("color_hex", sa.String(), nullable=True),
        sa.Column("diameter_mm", sa.Numeric(5, 2), server_default="1.75", nullable=True),
        sa.Column("density_g_cm3", sa.Numeric(6, 3), nullable=True),
        sa.Column("nozzle_temp_min", sa.Integer(), nullable=True),
        sa.Column("nozzle_temp_max", sa.Integer(), nullable=True),
        sa.Column("bed_temp_min", sa.Integer(), nullable=True),
        sa.Column("bed_temp_max", sa.Integer(), nullable=True),
        sa.Column("flow_ratio", sa.Numeric(6, 3), nullable=True),
        sa.Column("pressure_advance", sa.Numeric(8, 5), nullable=True),
        sa.Column("fan_percent", sa.Integer(), nullable=True),
        sa.Column("print_speed_mm_s", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source_name", sa.String(), nullable=True),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("locations.id"), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "spools",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("filament_profile_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("filament_profiles.id"), nullable=True),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("locations.id"), nullable=True),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("initial_filament_weight_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("empty_spool_weight_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("current_weight_g", sa.Numeric(10, 2), nullable=False),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("opened_date", sa.Date(), nullable=True),
        sa.Column("price", sa.Numeric(10, 2), nullable=True),
        sa.Column("currency", sa.String(), server_default="RUB", nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="new"),
        sa.Column("qr_token", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("qr_token"),
    )

    op.create_table(
        "spool_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("spool_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spools.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("weight_before_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("weight_after_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("delta_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_spool_events_spool_id", "spool_events", ["spool_id"])

    op.create_table(
        "printers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("integration_type", sa.String(), nullable=False, server_default="manual"),
        sa.Column("moonraker_url", sa.String(), nullable=True),
        sa.Column("moonraker_api_key_encrypted", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "printer_slots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("printer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("printers.id"), nullable=False),
        sa.Column("slot_index", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("current_spool_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spools.id"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("printer_id", "slot_index"),
    )

    op.create_table(
        "slot_assignment_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("printer_slot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("printer_slots.id"), nullable=False),
        sa.Column("spool_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spools.id"), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("unassigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "print_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("printer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("printers.id"), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="manual_upload"),
        sa.Column("file_name", sa.String(), nullable=True),
        sa.Column("file_hash", sa.String(), nullable=True),
        sa.Column("slicer_name", sa.String(), nullable=True),
        sa.Column("slicer_version", sa.String(), nullable=True),
        sa.Column("estimated_print_time_sec", sa.Integer(), nullable=True),
        sa.Column("filament_change_count", sa.Integer(), nullable=True),
        sa.Column("total_filament_used_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("total_filament_used_mm", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("parsed_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "print_job_tool_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("print_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("print_jobs.id"), nullable=False),
        sa.Column("tool_index", sa.Integer(), nullable=False),
        sa.Column("slot_index", sa.Integer(), nullable=True),
        sa.Column("material", sa.String(), nullable=True),
        sa.Column("color_hex", sa.String(), nullable=True),
        sa.Column("used_g", sa.Numeric(10, 2), nullable=True),
        sa.Column("used_mm", sa.Numeric(12, 2), nullable=True),
        sa.Column("parsed_metadata", postgresql.JSONB(), nullable=True),
        sa.UniqueConstraint("print_job_id", "tool_index"),
    )

    op.create_table(
        "print_job_spool_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("print_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("print_jobs.id"), nullable=False),
        sa.Column("spool_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spools.id"), nullable=False),
        sa.Column("printer_slot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("printer_slots.id"), nullable=True),
        sa.Column("tool_index", sa.Integer(), nullable=True),
        sa.Column("used_g", sa.Numeric(10, 2), nullable=False),
        sa.Column("used_mm", sa.Numeric(12, 2), nullable=True),
        sa.Column("confirmed_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("print_job_spool_usage")
    op.drop_table("print_job_tool_usage")
    op.drop_table("print_jobs")
    op.drop_table("slot_assignment_history")
    op.drop_table("printer_slots")
    op.drop_table("printers")
    op.drop_index("ix_spool_events_spool_id", table_name="spool_events")
    op.drop_table("spool_events")
    op.drop_table("spools")
    op.drop_table("locations")
    op.drop_table("filament_profiles")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
