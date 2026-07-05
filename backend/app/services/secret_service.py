"""Авто-генерация и персист секретов (SECRET_KEY, ENCRYPTION_KEY).

Если ключи не заданы через окружение, генерируем их при первом старте и храним в
таблице app_secret — стабильно между рестартами (иначе JWT инвалидируются, а
зашифрованные ключи принтеров становятся нечитаемыми). Значения из env имеют
приоритет и в БД не пишутся — продвинутый/секьюрный сценарий не затронут.

Это включает установку «в один клик» на CasaOS/Umbrel/Unraid без ручной генерации.
"""
import secrets as _secrets

from cryptography.fernet import Fernet
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings

# Значения-заглушки из config.py (и пустая строка от пустой env) = «не задано».
PLACEHOLDERS = {"", "change-me", "change-me-generate-a-fernet-key"}


def _get_or_create(db: Session, name: str, generate) -> str:
    """Race-safe: конкурентные backend и worker получат один и тот же ключ.

    INSERT ... ON CONFLICT DO NOTHING под PK-локом: первый писатель фиксирует
    значение, остальные его же и читают.
    """
    db.execute(
        text("INSERT INTO app_secret (key, value) VALUES (:k, :v) ON CONFLICT (key) DO NOTHING"),
        {"k": name, "v": generate()},
    )
    db.commit()
    return db.execute(text("SELECT value FROM app_secret WHERE key = :k"), {"k": name}).scalar()


def ensure_secrets(db: Session) -> None:
    if settings.secret_key in PLACEHOLDERS:
        settings.secret_key = _get_or_create(db, "secret_key", lambda: _secrets.token_urlsafe(48))
    if settings.encryption_key in PLACEHOLDERS:
        settings.encryption_key = _get_or_create(
            db, "encryption_key", lambda: Fernet.generate_key().decode()
        )
