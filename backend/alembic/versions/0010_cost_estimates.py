"""cost_estimates table and per-printer cost params

Revision ID: 0010_cost_estimates
Revises: 0009_user_theme
Create Date: 2026-08-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_cost_estimates"
down_revision: Union[str, None] = "0009_user_theme"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cost_estimates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("revision", sa.String()),
        sa.Column("notes", sa.Text()),
        sa.Column("printer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("printers.id")),
        sa.Column("print_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("print_jobs.id")),
        sa.Column("currency", sa.String(), nullable=False, server_default="RUB"),
        sa.Column("inputs", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("totals", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("landed_cost", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cost_estimates_owner", "cost_estimates", ["owner_user_id"])
    op.add_column(
        "printers",
        sa.Column("cost_params", postgresql.JSONB(astext_type=sa.Text())),
    )


def downgrade() -> None:
    op.drop_column("printers", "cost_params")
    op.drop_index("ix_cost_estimates_owner", table_name="cost_estimates")
    op.drop_table("cost_estimates")
