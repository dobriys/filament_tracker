"""Проверка новых версий на GitHub: кэш, сравнение версий, деградация при ошибке."""
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.services import update_check


class FakeDB:
    """Настройки читаются подменённым settings_service — сессия не нужна."""


@pytest.fixture
def store(monkeypatch):
    values = {}
    monkeypatch.setattr(
        update_check.settings_service, "get_value",
        lambda db, key, default=None: values.get(key, default),
    )
    monkeypatch.setattr(
        update_check.settings_service, "set_value",
        lambda db, key, value: values.__setitem__(key, value),
    )
    return values


def _set_version(monkeypatch, version):
    monkeypatch.setattr(update_check.settings, "app_version", version)


def test_no_update_when_versions_match(monkeypatch, store):
    _set_version(monkeypatch, "v1.2.3")
    monkeypatch.setattr(
        update_check, "_fetch_latest_release",
        lambda: {"latest_version": "v1.2.3", "release_url": "https://x"},
    )
    status = update_check.get_status(FakeDB())
    assert status["update_available"] is False
    assert status["latest_version"] == "v1.2.3"


def test_update_available_and_cached(monkeypatch, store):
    _set_version(monkeypatch, "v1.2.3")
    calls = {"n": 0}

    def fetch():
        calls["n"] += 1
        return {"latest_version": "v1.3.0", "release_url": "https://x/v1.3.0"}

    monkeypatch.setattr(update_check, "_fetch_latest_release", fetch)

    first = update_check.get_status(FakeDB())
    assert first["update_available"] is True
    assert first["latest_version"] == "v1.3.0"
    assert calls["n"] == 1

    # Второй вызов сразу после — кэш свежий, GitHub второй раз не дёргаем.
    second = update_check.get_status(FakeDB())
    assert second["update_available"] is True
    assert calls["n"] == 1


def test_stale_cache_is_refetched(monkeypatch, store):
    _set_version(monkeypatch, "v1.0.0")
    store[update_check.CACHE_KEY] = {
        "latest_version": "v1.0.0",
        "release_url": "https://x",
        "checked_at": (datetime.now(timezone.utc) - update_check.CACHE_TTL - timedelta(hours=1)).isoformat(),
    }
    monkeypatch.setattr(
        update_check, "_fetch_latest_release",
        lambda: {"latest_version": "v1.1.0", "release_url": "https://x/v1.1.0"},
    )
    status = update_check.get_status(FakeDB())
    assert status["latest_version"] == "v1.1.0"
    assert status["update_available"] is True


def test_github_unavailable_falls_back_without_raising(monkeypatch, store):
    _set_version(monkeypatch, "v1.2.3")

    def fetch():
        raise httpx.ConnectError("no network")

    monkeypatch.setattr(update_check, "_fetch_latest_release", fetch)
    status = update_check.get_status(FakeDB())
    assert status["update_available"] is False
    assert status["latest_version"] is None


def test_dev_build_never_reports_update(monkeypatch, store):
    _set_version(monkeypatch, "dev")
    monkeypatch.setattr(
        update_check, "_fetch_latest_release",
        lambda: {"latest_version": "v9.9.9", "release_url": "https://x"},
    )
    status = update_check.get_status(FakeDB())
    assert status["update_available"] is False
