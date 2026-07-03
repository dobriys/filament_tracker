"""add max_volumetric_speed to filament_profiles

Revision ID: 0002_max_vol_speed
Revises: 0001_initial
Create Date: 2026-06-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_max_vol_speed"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "filament_profiles",
        sa.Column("max_volumetric_speed", sa.Numeric(6, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("filament_profiles", "max_volumetric_speed")
