"""app_secret table for auto-generated persisted secrets

Revision ID: 0007_app_secret
Revises: 0006_printer_capabilities
Create Date: 2026-07-05

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_app_secret"
down_revision: Union[str, None] = "0006_printer_capabilities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_secret",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_secret")
