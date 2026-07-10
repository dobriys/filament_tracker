"""Фоновый поллер Moonraker: автоимпорт и автосписание завершённых печатей.

Запускается вместо rq-воркера (очереди сейчас не используются):
    python -m app.workers.poller
Интервал — MOONRAKER_POLL_INTERVAL секунд (по умолчанию 30).
"""
import logging
import time

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import diagnostics, moonraker_sync
from app.services.secret_service import ensure_secrets

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
log = logging.getLogger("poller")


def main() -> None:
    interval = max(5, settings.moonraker_poll_interval)
    # Те же ключи, что и у backend (нужны для расшифровки ключей принтеров).
    db = SessionLocal()
    try:
        ensure_secrets(db)
    finally:
        db.close()
    log.info("Moonraker poller started, interval=%ss", interval)
    while True:
        db = SessionLocal()
        try:
            # Отдельный процесс — обновляем кэш флага журнала из БД каждый цикл.
            diagnostics.load_enabled(db)
            moonraker_sync.poll_all(db)
        except Exception as e:
            log.exception("poll cycle failed")
            diagnostics.event(
                "error", "poller", f"Цикл опроса упал: {e}", category="poll",
                context={"type": e.__class__.__name__},
            )
        finally:
            db.close()
        time.sleep(interval)


if __name__ == "__main__":
    main()
