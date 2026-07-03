"""add specs JSONB to filament_profiles (catalog extended data)

Revision ID: 0005_profile_specs
Revises: 0004_spool_specs
Create Date: 2026-06-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_profile_specs"
down_revision: Union[str, None] = "0004_spool_specs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("filament_profiles", sa.Column("specs", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("filament_profiles", "specs")
