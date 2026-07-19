"""Разбор состояний Home Assistant и переходы влажности (без БД и сети)."""
from app.services.environment_watch import HYSTERESIS_PCT, diff, is_high
from app.services.homeassistant import _to_float, list_entities


def _cur(humidity, high, temperature=None):
    return {"high": high, "humidity": humidity, "temperature": temperature}


def _events(prev, cur, threshold=45.0):
    return [e for e, _ in diff(prev, cur, "Шкаф", threshold)]


# --- разбор состояний --------------------------------------------------------

def test_numeric_states_parsed():
    assert _to_float("27.87") == 27.87
    assert _to_float(46) == 46.0


def test_missing_states_become_none():
    # HA отдаёт эти значения, когда датчик отвалился или ещё не публиковался.
    for state in ("unknown", "unavailable", "", None, "не число"):
        assert _to_float(state) is None


def test_entities_filtered_by_device_class(monkeypatch):
    # Отбор идёт по device_class: entity_id зависит от имени устройства в HA.
    states = [
        {"entity_id": "sensor.ace_pro_temp_hum_temperature", "state": "46.29",
         "attributes": {"device_class": "temperature", "friendly_name": "ACE Pro Temperature"}},
        {"entity_id": "sensor.ace_pro_temp_hum_humidity", "state": "27.87",
         "attributes": {"device_class": "humidity", "friendly_name": "ACE Pro Humidity"}},
        {"entity_id": "sensor.ace_pro_temp_hum_linkquality", "state": "65",
         "attributes": {"friendly_name": "ACE Pro Linkquality"}},
        {"entity_id": "light.kitchen", "state": "on", "attributes": {}},
    ]
    monkeypatch.setattr("app.services.homeassistant.fetch_states", lambda *a: states)
    found = {e["entity_id"] for e in list_entities("http://ha", "token")}
    assert found == {
        "sensor.ace_pro_temp_hum_temperature",
        "sensor.ace_pro_temp_hum_humidity",
    }


# --- гистерезис --------------------------------------------------------------

def test_crossing_threshold_is_high():
    assert is_high(50.0, 45.0, was_high=False) is True


def test_well_below_threshold_is_normal():
    assert is_high(40.0, 45.0, was_high=True) is False


def test_dead_zone_keeps_previous_verdict():
    # Между порогом и порогом минус гистерезис вывод не меняется — иначе датчик
    # у самой границы слал бы уведомления каждый цикл опроса.
    middle = 45.0 - HYSTERESIS_PCT / 2
    assert is_high(middle, 45.0, was_high=True) is True
    assert is_high(middle, 45.0, was_high=False) is None


def test_no_reading_gives_no_verdict():
    assert is_high(None, 45.0, was_high=False) is None


# --- события -----------------------------------------------------------------

def test_alert_on_rise_and_recovery():
    assert _events(_cur(30, False), _cur(50, True)) == ["humidity_high"]
    assert _events(_cur(50, True), _cur(30, False)) == ["humidity_high"]


def test_no_event_while_state_holds():
    assert _events(_cur(50, True), _cur(52, True)) == []
    assert _events(_cur(30, False), _cur(28, False)) == []
    assert _events(_cur(30, False), _cur(44, None)) == []


def test_alert_text_carries_readings():
    _, text = diff(_cur(30, False), _cur(52.4, True, temperature=46.3), "Шкаф", 45.0)[0]
    assert "52%" in text and "46°C" in text and "45%" in text


def test_recovery_text_differs_from_alert():
    _, text = diff(_cur(52, True), _cur(30.2, False), "Шкаф", 45.0)[0]
    assert "в норму" in text and "30%" in text
