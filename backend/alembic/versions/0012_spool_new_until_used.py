"""spools: «new» only until the first consumption

Раньше «новая» катушка оставалась «новой» и после печатей — статус менялся
только при пересечении порога «заканчивается». Теперь первое списание
переводит её в «используется»; здесь то же правило применяется к катушкам,
с которых списывали до обновления.

Revision ID: 0012_spool_new_until_used
Revises: 0011_printer_camera
Create Date: 2026-11-23

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0012_spool_new_until_used"
down_revision: Union[str, None] = "0011_printer_camera"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE spools SET status = 'in_use'
        WHERE status = 'new'
          AND EXISTS (
            SELECT 1 FROM spool_events e
            WHERE e.spool_id = spools.id AND e.delta_g < 0
          )
        """
    )


def downgrade() -> None:
    # Какие катушки были «новыми» до обновления, уже не узнать — и не нужно:
    # прежний код «используется» не трогает.
    pass
