"""per-account UI theme preference

Revision ID: 0009_user_theme
Revises: 0008_diagnostic_events
Create Date: 2026-07-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_user_theme"
down_revision: Union[str, None] = "0008_diagnostic_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("theme", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "theme")
