from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.services import (
    diagnostics,
    homeassistant,
    notifications,
    settings_service,
)
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
    spool_low_pct: float
    spool_low_min_g: float
    spool_low_max_g: float
    humidity_alert_max_pct: float
    ha_enabled: bool
    ha_base_url: str | None
    # Токен наружу не отдаём — только признак, что он сохранён.
    ha_token_set: bool
    ha_sensors: list[dict]


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
    spool_low_pct: float | None = None
    spool_low_min_g: float | None = None
    spool_low_max_g: float | None = None
    humidity_alert_max_pct: float | None = None
    ha_enabled: bool | None = None
    ha_base_url: str | None = None
    # Пустая строка — стереть сохранённый токен.
    ha_token: str | None = None
    ha_sensors: list[dict] | None = None


def _current(db: Session) -> SettingsOut:
    low = settings_service.low_config(db)
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
        spool_low_pct=low["pct"],
        spool_low_min_g=low["min_g"],
        spool_low_max_g=low["max_g"],
        humidity_alert_max_pct=homeassistant.humidity_max(db),
        ha_enabled=settings_service.get_bool(db, homeassistant.ENABLED_KEY, default=False),
        ha_base_url=homeassistant.get_base_url(db),
        ha_token_set=bool(settings_service.get_value(db, homeassistant.TOKEN_KEY)),
        ha_sensors=homeassistant.get_sensors(db),
    )


def _recompute_spool_statuses(db: Session) -> None:
    """Пересчитать статусы всех катушек под новые настройки порога.

    Порог у каждой катушки свой — он считается от её ёмкости, поэтому конфиг
    читаем один раз, а сам порог берём для каждой отдельно.
    """
    from sqlalchemy import select

    from app.models import Spool
    from app.services import spool_service

    cfg = settings_service.low_config(db)
    for spool in db.scalars(select(Spool).where(Spool.status != "archived")):
        threshold = settings_service.low_threshold_for(spool.initial_filament_weight_g, cfg)
        spool_service.recompute_status(spool, threshold)
    db.commit()


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
    low_changed = False
    if data.spool_low_pct is not None:
        if not (0 <= data.spool_low_pct <= 100):
            raise HTTPException(status_code=422, detail="Доля остатка: от 0 до 100 %")
        settings_service.set_value(db, settings_service.SPOOL_LOW_PCT_KEY, data.spool_low_pct)
        low_changed = True
    for value, key, name in (
        (data.spool_low_min_g, settings_service.SPOOL_LOW_MIN_KEY, "Нижний зажим"),
        (data.spool_low_max_g, settings_service.SPOOL_LOW_MAX_KEY, "Верхний зажим"),
    ):
        if value is None:
            continue
        if not (0 < value <= 10000):
            raise HTTPException(status_code=422, detail=f"{name} остатка: от 1 до 10000 г")
        settings_service.set_value(db, key, value)
        low_changed = True
    if low_changed:
        # Порог задаёт статусы катушек, а не только момент уведомления, поэтому
        # после его смены статусы надо пересчитать: иначе катушки остались бы
        # «почти закончились» по старой мерке до ближайшего изменения веса.
        _recompute_spool_statuses(db)
    if data.humidity_alert_max_pct is not None:
        if not (0 < data.humidity_alert_max_pct < 100):
            raise HTTPException(status_code=422, detail="Порог влажности: от 1 до 99 %")
        settings_service.set_value(
            db, homeassistant.HUMIDITY_MAX_KEY, data.humidity_alert_max_pct
        )
    if data.ha_enabled is not None:
        settings_service.set_value(db, homeassistant.ENABLED_KEY, data.ha_enabled)
    if data.ha_base_url is not None:
        url = data.ha_base_url.strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            url = f"http://{url}"  # адрес обычно вводят как 192.168.0.63:8123
        settings_service.set_value(db, homeassistant.BASE_URL_KEY, url or None)
    if data.ha_token is not None:
        homeassistant.set_token(db, data.ha_token.strip() or None)
    if data.ha_sensors is not None:
        homeassistant.set_sensors(db, data.ha_sensors)
    # Адрес, токен и состав датчиков меняют то, что лежит в кэше опроса.
    if (data.ha_base_url, data.ha_token, data.ha_sensors) != (None, None, None):
        homeassistant.invalidate_cache()
    return _current(db)


@router.get("/homeassistant/entities")
def homeassistant_entities(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Датчики температуры/влажности/заряда из HA — для выбора в настройках."""
    base_url, token = homeassistant.get_base_url(db), homeassistant.get_token(db)
    if not base_url or not token:
        raise HTTPException(status_code=422, detail="Сначала укажите адрес и токен Home Assistant")
    try:
        return {"entities": homeassistant.list_entities(base_url, token)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=homeassistant.explain_error(str(e)))


@router.post("/homeassistant/test")
def homeassistant_test(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Проверить связь с Home Assistant текущими настройками."""
    base_url, token = homeassistant.get_base_url(db), homeassistant.get_token(db)
    if not base_url or not token:
        raise HTTPException(status_code=422, detail="Укажите адрес и токен Home Assistant")
    try:
        entities = homeassistant.list_entities(base_url, token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=homeassistant.explain_error(str(e)))
    return {"ok": True, "sensors_found": len(entities)}


@router.post("/telegram/detect-chat")
def telegram_detect_chat(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Определить chat id по тем, кто уже написал боту."""
    token = notifications.get_token(db)
    if not token:
        raise HTTPException(status_code=422, detail="Сначала сохраните токен бота")
    try:
        chats = notifications.detect_chat_id(token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=notifications.explain_error(str(e)))
    if not chats:
        raise HTTPException(
            status_code=404,
            detail="Никто не писал боту. Откройте своего бота в Telegram, "
                   "отправьте ему «/start» и нажмите кнопку ещё раз.",
        )
    return {"chats": chats}


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
        raise HTTPException(status_code=502, detail=notifications.explain_error(str(e)))
    return {"ok": True}
