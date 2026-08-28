"""add camera_url to printers

Revision ID: 0011_printer_camera
Revises: 0010_cost_estimates
Create Date: 2026-08-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_printer_camera"
down_revision: Union[str, None] = "0010_cost_estimates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("printers", sa.Column("camera_url", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("printers", "camera_url")
