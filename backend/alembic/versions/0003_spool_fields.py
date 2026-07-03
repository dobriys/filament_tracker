"""add spool-level material/print/photo fields

Revision ID: 0003_spool_fields
Revises: 0002_max_vol_speed
Create Date: 2026-06-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_spool_fields"
down_revision: Union[str, None] = "0002_max_vol_speed"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    ("sku", sa.String()),
    ("manufacturer", sa.String()),
    ("barcode", sa.String()),
    ("photo", sa.Text()),
    ("material", sa.String()),
    ("color_name", sa.String()),
    ("color_hex", sa.String()),
    ("diameter_mm", sa.Numeric(5, 2)),
    ("hotend_temp", sa.Integer()),
    ("bed_temp", sa.Integer()),
    ("fan_speed", sa.Integer()),
    ("flow_rate", sa.Numeric(6, 2)),
]


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column("spools", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("spools", name)
