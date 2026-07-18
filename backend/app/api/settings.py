from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.services import diagnostics, notifications, settings_service
from app.services.moonraker_sync import AUTO_CONSUME_KEY, AUTO_IMPORT_KEY

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsOut(BaseModel):
    allow_negative_consumption: bool
    moonraker_auto_import: bool
    moonraker_auto_consume: bool
    error_logging: bool
    telegram_enabled: bool
    telegram_chat_id: str | None
    # Сам токен наружу не отдаём — только признак, что он сохранён.
    telegram_token_set: bool
    telegram_events: dict[str, bool]
    spool_low_threshold_g: float


class SettingsUpdate(BaseModel):
    allow_negative_consumption: bool | None = None
    moonraker_auto_import: bool | None = None
    moonraker_auto_consume: bool | None = None
    error_logging: bool | None = None
    telegram_enabled: bool | None = None
    telegram_chat_id: str | None = None
    # Пустая строка — стереть сохранённый токен.
    telegram_bot_token: str | None = None
    telegram_events: dict[str, bool] | None = None
    spool_low_threshold_g: float | None = None


def _current(db: Session) -> SettingsOut:
    return SettingsOut(
        allow_negative_consumption=settings_service.get_bool(
            db, settings_service.ALLOW_NEGATIVE_KEY
        ),
        moonraker_auto_import=settings_service.get_bool(db, AUTO_IMPORT_KEY, default=True),
        moonraker_auto_consume=settings_service.get_bool(db, AUTO_CONSUME_KEY, default=False),
        error_logging=settings_service.get_bool(db, diagnostics.ERROR_LOGGING_KEY, default=False),
        telegram_enabled=settings_service.get_bool(db, notifications.ENABLED_KEY, default=False),
        telegram_chat_id=settings_service.get_value(db, notifications.CHAT_ID_KEY),
        telegram_token_set=bool(settings_service.get_value(db, notifications.TOKEN_KEY)),
        telegram_events=notifications.get_events(db),
        spool_low_threshold_g=notifications.spool_low_threshold(db),
    )


@router.get("", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    return _current(db)


@router.put("", response_model=SettingsOut)
def update_settings(
    data: SettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if data.allow_negative_consumption is not None:
        settings_service.set_value(
            db, settings_service.ALLOW_NEGATIVE_KEY, data.allow_negative_consumption
        )
    if data.moonraker_auto_import is not None:
        settings_service.set_value(db, AUTO_IMPORT_KEY, data.moonraker_auto_import)
    if data.moonraker_auto_consume is not None:
        settings_service.set_value(db, AUTO_CONSUME_KEY, data.moonraker_auto_consume)
    if data.error_logging is not None:
        settings_service.set_value(db, diagnostics.ERROR_LOGGING_KEY, data.error_logging)
        diagnostics.set_enabled(data.error_logging)  # обновляем кэш для middleware
    if data.telegram_enabled is not None:
        settings_service.set_value(db, notifications.ENABLED_KEY, data.telegram_enabled)
    if data.telegram_chat_id is not None:
        settings_service.set_value(
            db, notifications.CHAT_ID_KEY, data.telegram_chat_id.strip() or None
        )
    if data.telegram_bot_token is not None:
        notifications.set_token(db, data.telegram_bot_token.strip() or None)
    if data.telegram_events is not None:
        notifications.set_events(db, data.telegram_events)
    if data.spool_low_threshold_g is not None:
        if not (0 < data.spool_low_threshold_g <= 10000):
            raise HTTPException(status_code=422, detail="Порог остатка: от 1 до 10000 г")
        settings_service.set_value(
            db, notifications.SPOOL_LOW_KEY, data.spool_low_threshold_g
        )
    return _current(db)


@router.post("/telegram/test")
def telegram_test(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Отправить тестовое сообщение текущими настройками бота."""
    token = notifications.get_token(db)
    chat_id = settings_service.get_value(db, notifications.CHAT_ID_KEY)
    if not token or not chat_id:
        raise HTTPException(status_code=422, detail="Укажите токен бота и chat id")
    try:
        notifications.send_message(
            token, str(chat_id),
            "🧵 <b>Filament Tracker</b>\nУведомления настроены.",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telegram: {e}")
    return {"ok": True}
