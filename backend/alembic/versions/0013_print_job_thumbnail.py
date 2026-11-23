"""print_jobs: thumbnail of the printed model

Revision ID: 0013_print_job_thumbnail
Revises: 0012_spool_new_until_used
Create Date: 2026-11-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0013_print_job_thumbnail"
down_revision: Union[str, None] = "0012_spool_new_until_used"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("print_jobs", sa.Column("thumbnail", JSONB(none_as_null=True), nullable=True))


def downgrade() -> None:
    op.drop_column("print_jobs", "thumbnail")
