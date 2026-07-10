"""diagnostic_events table for the opt-in diagnostics log

Revision ID: 0008_diagnostic_events
Revises: 0007_app_secret
Create Date: 2026-07-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_diagnostic_events"
down_revision: Union[str, None] = "0007_app_secret"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "diagnostic_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("category", sa.String(length=32)),
        sa.Column("action", sa.String(length=255)),
        sa.Column("message", sa.Text()),
        sa.Column("method", sa.String(length=8)),
        sa.Column("path", sa.String(length=512)),
        sa.Column("status", sa.Integer()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("user_email", sa.String(length=255)),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text())),
    )
    op.create_index("ix_diagnostic_events_ts", "diagnostic_events", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_diagnostic_events_ts", table_name="diagnostic_events")
    op.drop_table("diagnostic_events")
