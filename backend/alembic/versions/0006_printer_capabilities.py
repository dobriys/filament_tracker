"""add brand/model/capabilities to printers

Revision ID: 0006_printer_capabilities
Revises: 0005_profile_specs
Create Date: 2026-07-04

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_printer_capabilities"
down_revision: Union[str, None] = "0005_profile_specs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("printers", sa.Column("brand", sa.String(), nullable=True))
    op.add_column("printers", sa.Column("model", sa.String(), nullable=True))
    op.add_column(
        "printers",
        sa.Column("capabilities", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("printers", "capabilities")
    op.drop_column("printers", "model")
    op.drop_column("printers", "brand")
