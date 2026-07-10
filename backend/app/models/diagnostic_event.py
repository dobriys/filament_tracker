from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DiagnosticEvent(Base):
    """Запись диагностического журнала.

    Общая для всех процессов (API-воркеры + фоновый поллер) — поэтому хранится в
    БД, а не в памяти. Пишется только когда журнал включён; объём ограничивается
    чисткой старых записей (см. services/diagnostics.py).
    """

    __tablename__ = "diagnostic_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    level: Mapped[str] = mapped_column(String(16), nullable=False)   # info | warning | error
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # http | backend | poller | frontend
    category: Mapped[str | None] = mapped_column(String(32))         # consume | dryer | spool | request | ...
    action: Mapped[str | None] = mapped_column(String(255))          # краткое действие (метод+путь / глагол)
    message: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str | None] = mapped_column(String(8))
    path: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    user_email: Mapped[str | None] = mapped_column(String(255))
    context: Mapped[dict | None] = mapped_column(JSONB)              # тело запроса (без секретов), детали, traceback
