"""add specs JSONB to spools (extended filament technical data)

Revision ID: 0004_spool_specs
Revises: 0003_spool_fields
Create Date: 2026-06-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_spool_specs"
down_revision: Union[str, None] = "0003_spool_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("spools", sa.Column("specs", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("spools", "specs")
