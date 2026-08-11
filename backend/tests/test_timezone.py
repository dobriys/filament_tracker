"""Часовой пояс для времени в уведомлениях (без БД: настройка подменяется)."""
from datetime import datetime, timezone

import pytest

from app.services import settings_service


@pytest.fixture
def tz_setting(monkeypatch):
    """Подставляет значение настройки timezone вместо чтения из базы."""
    def setup(name):
        monkeypatch.setattr(
            settings_service, "get_value",
            lambda db, key, default=None: name if key == settings_service.TIMEZONE_KEY else default,
        )
    return setup


def test_utc_converted_to_configured_zone(tz_setting):
    tz_setting("Europe/Moscow")
    # Ровно тот случай из-за которого настройку и заводили: печать завершилась
    # в 00:28 UTC, а пользователь видел в сообщении время на три часа раньше.
    ts = datetime(2026, 8, 11, 0, 28, tzinfo=timezone.utc)
    assert f"{settings_service.to_local(None, ts):%d.%m.%Y %H:%M}" == "11.08.2026 03:28"


def test_naive_time_treated_as_utc(tz_setting):
    tz_setting("Europe/Moscow")
    local = settings_service.to_local(None, datetime(2026, 8, 11, 0, 28))
    assert f"{local:%H:%M}" == "03:28"


def test_unset_keeps_server_zone(tz_setting):
    tz_setting(None)
    ts = datetime(2026, 8, 11, 0, 28, tzinfo=timezone.utc)
    assert settings_service.to_local(None, ts) == ts.astimezone()


def test_unknown_zone_does_not_break_notification(tz_setting):
    # Имя может остаться от другой системы, где такой пояс существовал.
    tz_setting("Mars/Olympus")
    ts = datetime(2026, 8, 11, 0, 28, tzinfo=timezone.utc)
    assert settings_service.to_local(None, ts) == ts.astimezone()


def test_zone_names_validated():
    assert settings_service.valid_timezone("Europe/Moscow")
    assert settings_service.valid_timezone("UTC")
    assert not settings_service.valid_timezone("Europe/Moskva")
    assert not settings_service.valid_timezone("")
