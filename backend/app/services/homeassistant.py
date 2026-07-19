"""Датчики температуры и влажности из Home Assistant.

Филамент боится влаги, а сушилка и шкаф хранения обычно уже увешаны zigbee-
датчиками — забирать их показания проще, чем городить своё железо. Home
Assistant отдаёт состояние любой сущности по REST, поэтому источник датчика
(zigbee2mqtt, ESPHome, Bluetooth) приложение не волнует.

Настройки живут в app_settings рядом с телеграмными: адрес HA, long-lived
токен (шифруется, как токен бота и ключи принтеров) и список датчиков. Список —
это JSON, поэтому добавление датчика не требует миграции БД.

Датчик можно привязать к месту хранения или к принтеру (bind_type/bind_id) —
тогда показания видно там, где лежат катушки, а не только общим списком.

Опрос кэшируется на CACHE_TTL_SEC: карточка на дашборде обновляется чаще, чем
меняются показания, а HA не должен страдать от открытой вкладки.
"""
import logging
import time
import uuid

import httpx
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret, encrypt_secret
from app.services import settings_service

log = logging.getLogger("homeassistant")

ENABLED_KEY = "ha_enabled"
BASE_URL_KEY = "ha_base_url"
TOKEN_KEY = "ha_token_encrypted"
SENSORS_KEY = "ha_sensors"

TIMEOUT_SEC = 10
CACHE_TTL_SEC = 30

# Значения HA, означающие «данных нет» (датчик не отвечает, ещё не публиковался).
UNKNOWN_STATES = {"unknown", "unavailable", "none", ""}

# Кэш последнего опроса: (момент, {entity_id: состояние}). Процесс бэкенда и
# процесс поллера кэшируют независимо — это осознанно, они опрашивают в разном
# ритме и общего состояния между ними нет.
_cache: tuple[float, dict] | None = None


# --- конфигурация ------------------------------------------------------------

def get_base_url(db: Session) -> str | None:
    url = settings_service.get_value(db, BASE_URL_KEY)
    return str(url).rstrip("/") if url else None


def get_token(db: Session) -> str | None:
    """Расшифрованный токен (None, если не задан или сменился ключ шифрования)."""
    enc = settings_service.get_value(db, TOKEN_KEY)
    if not enc:
        return None
    try:
        return decrypt_secret(enc)
    except Exception:
        log.warning("не удалось расшифровать токен Home Assistant")
        return None


def set_token(db: Session, token: str | None) -> None:
    settings_service.set_value(db, TOKEN_KEY, encrypt_secret(token) if token else None)


def is_configured(db: Session) -> bool:
    return bool(get_base_url(db) and get_token(db))


def get_sensors(db: Session) -> list[dict]:
    saved = settings_service.get_value(db, SENSORS_KEY) or []
    return [s for s in saved if isinstance(s, dict)] if isinstance(saved, list) else []


def set_sensors(db: Session, sensors: list[dict]) -> list[dict]:
    """Нормализовать и сохранить список датчиков.

    id проставляется сам: фронту нечем адресовать датчик до сохранения, а по
    имени связывать нельзя — его переименовывают.
    """
    clean = []
    for raw in sensors or []:
        if not isinstance(raw, dict):
            continue
        temp = (raw.get("temp_entity") or "").strip()
        humidity = (raw.get("humidity_entity") or "").strip()
        if not temp and not humidity:
            continue  # датчик без единой сущности показывать нечего
        bind_type = raw.get("bind_type") if raw.get("bind_type") in ("printer", "location") else None
        clean.append({
            "id": str(raw.get("id") or uuid.uuid4()),
            "name": (raw.get("name") or "").strip() or "Датчик",
            "temp_entity": temp,
            "humidity_entity": humidity,
            "battery_entity": (raw.get("battery_entity") or "").strip(),
            "bind_type": bind_type,
            "bind_id": str(raw["bind_id"]) if bind_type and raw.get("bind_id") else None,
        })
    settings_service.set_value(db, SENSORS_KEY, clean)
    return clean


# --- обращение к Home Assistant ----------------------------------------------

def fetch_states(base_url: str, token: str) -> list[dict]:
    """Все сущности HA одним запросом. Бросает исключение — используется в «Проверить»."""
    r = httpx.get(
        f"{base_url.rstrip('/')}/api/states",
        headers={"Authorization": f"Bearer {token}"},
        timeout=TIMEOUT_SEC,
    )
    if r.status_code == 401:
        raise RuntimeError("401 Unauthorized")
    r.raise_for_status()
    payload = r.json()
    if not isinstance(payload, list):
        raise RuntimeError("неожиданный ответ Home Assistant")
    return payload


def list_entities(base_url: str, token: str) -> list[dict]:
    """Датчики температуры/влажности/заряда — для выпадающего списка в настройках.

    Отбор по device_class, а не по имени: entity_id зависит от того, как
    пользователь назвал устройство, и угадывать его бессмысленно.
    """
    wanted = {"temperature", "humidity", "battery"}
    out = []
    for st in fetch_states(base_url, token):
        attrs = st.get("attributes") or {}
        device_class = attrs.get("device_class")
        if device_class not in wanted:
            continue
        out.append({
            "entity_id": st.get("entity_id"),
            "name": attrs.get("friendly_name") or st.get("entity_id"),
            "device_class": device_class,
            "unit": attrs.get("unit_of_measurement"),
            "state": st.get("state"),
        })
    out.sort(key=lambda e: e["name"].lower())
    return out


def _to_float(state) -> float | None:
    if state is None or str(state).strip().lower() in UNKNOWN_STATES:
        return None
    try:
        return float(state)
    except (TypeError, ValueError):
        return None


def _states_by_id(base_url: str, token: str, *, use_cache: bool = True) -> dict:
    global _cache
    now = time.monotonic()
    if use_cache and _cache and now - _cache[0] < CACHE_TTL_SEC:
        return _cache[1]
    index = {st.get("entity_id"): st for st in fetch_states(base_url, token)}
    _cache = (now, index)
    return index


def invalidate_cache() -> None:
    """Сбросить кэш — после смены адреса, токена или списка датчиков."""
    global _cache
    _cache = None


def read_sensors(db: Session, *, use_cache: bool = True) -> list[dict]:
    """Текущие показания настроенных датчиков.

    Ошибки не пробрасываются: карточка на дашборде и опрос в поллере не должны
    падать из-за недоступного HA — вместо значений уходит поле error.
    """
    sensors = get_sensors(db)
    if not sensors:
        return []
    if not settings_service.get_bool(db, ENABLED_KEY, default=False):
        return []

    base_url, token = get_base_url(db), get_token(db)
    if not base_url or not token:
        return []

    try:
        states = _states_by_id(base_url, token, use_cache=use_cache)
        error = None
    except Exception as e:
        states, error = {}, explain_error(str(e))

    out = []
    for s in sensors:
        temp_state = states.get(s.get("temp_entity"))
        hum_state = states.get(s.get("humidity_entity"))
        bat_state = states.get(s.get("battery_entity"))
        # Время последнего изменения берём у того датчика, что реально настроен.
        updated = (hum_state or temp_state or {}).get("last_updated")
        out.append({
            "id": s.get("id"),
            "name": s.get("name"),
            "temperature": _to_float((temp_state or {}).get("state")),
            "humidity": _to_float((hum_state or {}).get("state")),
            "battery": _to_float((bat_state or {}).get("state")),
            "updated_at": updated,
            "bind_type": s.get("bind_type"),
            "bind_id": s.get("bind_id"),
            "error": error,
        })
    return out


def explain_error(detail: str) -> str:
    """Подсказка к типовым ответам HA — сырой текст мало что объясняет."""
    low = detail.lower()
    if "401" in low or "unauthorized" in low:
        return (
            f"{detail}. Проверьте токен: Home Assistant → профиль → «Токены "
            "долгосрочного доступа» → «Создать токен»."
        )
    if "404" in low:
        return f"{detail}. Адрес указан неверно — нужен корень, например http://192.168.0.63:8123"
    if "connect" in low or "timeout" in low or "timed out" in low:
        return f"{detail}. Home Assistant недоступен по этому адресу с сервера приложения."
    return detail
