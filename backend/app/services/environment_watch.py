"""Наблюдение за влажностью по датчикам Home Assistant.

Смысл тот же, что у printer_watch: поллер каждый цикл снимает показания,
сравнивает с прошлым срезом (app_settings, ключ env_watch:<sensor_id>) и
превращает переходы в уведомления. Память между циклами поллер не переживает,
поэтому срез хранится в БД.

Порог один — верхний: филаменту вредит именно набранная влага. Чтобы датчик,
болтающийся возле порога, не слал уведомления каждые полминуты, возврат в норму
засчитывается только ниже порога на HYSTERESIS_PCT.

При первом наблюдении событие не выдаётся: срез просто запоминается, иначе
после каждого рестарта поллера приходило бы уведомление о том, что и так не
менялось.
"""
import logging

from sqlalchemy.orm import Session

from app.services import homeassistant, notifications, settings_service

log = logging.getLogger("environment_watch")

STATE_PREFIX = "env_watch:"

# Порог «влажность высокая», проценты.
HUMIDITY_MAX_KEY = "humidity_alert_max_pct"
HUMIDITY_MAX_DEFAULT = 45.0
# Запас на возврат в норму, проценты.
HYSTERESIS_PCT = 2.0


def humidity_max(db: Session) -> float:
    try:
        return float(settings_service.get_value(db, HUMIDITY_MAX_KEY, HUMIDITY_MAX_DEFAULT))
    except (TypeError, ValueError):
        return HUMIDITY_MAX_DEFAULT


def is_high(humidity: float | None, threshold: float, *, was_high: bool) -> bool | None:
    """Считается ли влажность высокой с учётом гистерезиса.

    None — состояние не изменилось настолько, чтобы делать вывод (мёртвая зона
    между порогом и порогом минус гистерезис), или показаний нет.
    """
    if humidity is None:
        return None
    if humidity > threshold:
        return True
    if humidity <= threshold - HYSTERESIS_PCT:
        return False
    return None if not was_high else True


def diff(prev: dict, cur: dict, name: str, threshold: float) -> list[tuple[str, str]]:
    """Переход между срезами → [(тип события, текст)]. Чистая функция."""
    was_high = bool(prev.get("high"))
    now_high = cur.get("high")
    if now_high is None or now_high == was_high:
        return []

    label = notifications.esc(name)
    humidity = cur.get("humidity")
    value = f"{humidity:.0f}%" if isinstance(humidity, (int, float)) else "—"
    temp = cur.get("temperature")
    temp_part = f", {temp:.0f}°C" if isinstance(temp, (int, float)) else ""

    if now_high:
        return [(
            "humidity_high",
            f"💧 <b>{label}</b>\nВлажность {value}{temp_part} — выше порога {threshold:.0f}%",
        )]
    return [(
        "humidity_high",
        f"🍃 <b>{label}</b>\nВлажность вернулась в норму: {value}{temp_part}",
    )]


def watch_all(db: Session) -> None:
    """Один цикл наблюдения за всеми датчиками.

    Пропускается целиком, пока уведомления не настроены — чтобы не дёргать Home
    Assistant у тех, кому уведомления не нужны.
    """
    if not settings_service.get_bool(db, notifications.ENABLED_KEY, default=False):
        return
    if not notifications.is_configured(db):
        return
    if not notifications.get_events(db).get("humidity_high"):
        return

    threshold = humidity_max(db)
    # Поллер ходит реже кэша, но у него свой процесс и свой кэш — берём свежее.
    for reading in homeassistant.read_sensors(db, use_cache=False):
        if reading.get("error"):
            continue
        key = f"{STATE_PREFIX}{reading['id']}"
        prev = settings_service.get_value(db, key)
        high = is_high(
            reading.get("humidity"), threshold,
            was_high=bool(prev.get("high")) if isinstance(prev, dict) else False,
        )
        cur = {
            "high": high,
            "humidity": reading.get("humidity"),
            "temperature": reading.get("temperature"),
        }
        if not isinstance(prev, dict):
            settings_service.set_value(db, key, cur)  # первое наблюдение — только запоминаем
            continue
        if high is None:
            continue  # мёртвая зона: прошлый вывод остаётся в силе, срез не трогаем

        try:
            for event, text in diff(prev, cur, reading.get("name") or "Датчик", threshold):
                notifications.notify(db, event, text)
        except Exception as e:  # не валим цикл поллера из-за одного датчика
            log.warning("watch %s failed: %s", reading.get("name"), e)
        settings_service.set_value(db, key, cur)
