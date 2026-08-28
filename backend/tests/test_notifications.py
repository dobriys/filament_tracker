"""Кадр с камеры в уведомлениях: когда прикладывается и что если камеры нет."""
import pytest

from app.services import camera, notifications


class FakeDB:
    """Настройки читаются подменённым settings_service — сессия не нужна."""


@pytest.fixture
def tg(monkeypatch):
    """Настроенный бот, включённые уведомления и перехват отправки."""
    values = {
        notifications.ENABLED_KEY: True,
        notifications.CHAT_ID_KEY: "42",
        notifications.EVENTS_KEY: {"print_finished": True, "spool_low": True},
        notifications.PHOTO_ENABLED_KEY: True,
    }
    sent = {"messages": [], "photos": []}

    monkeypatch.setattr(
        notifications.settings_service, "get_value",
        lambda db, key, default=None: values.get(key, default),
    )
    monkeypatch.setattr(
        notifications.settings_service, "get_bool",
        lambda db, key, default=False: bool(values.get(key, default)),
    )
    monkeypatch.setattr(notifications, "get_token", lambda db: "token")
    monkeypatch.setattr(
        notifications, "send_message",
        lambda token, chat_id, text: sent["messages"].append(text) or {"ok": True},
    )
    monkeypatch.setattr(
        notifications, "send_photo",
        lambda token, chat_id, photo, caption="": sent["photos"].append((photo, caption))
        or {"ok": True},
    )
    return values, sent


def _camera(monkeypatch, result):
    """Камера отдаёт кадр, ничего не отдаёт или падает."""
    def snapshot(db, printer, **kw):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(camera, "snapshot", snapshot)


def test_photo_goes_with_the_message_as_caption(monkeypatch, tg):
    _, sent = tg
    _camera(monkeypatch, b"jpeg")
    assert notifications.notify(FakeDB(), "print_finished", "Печать завершена", printer=object())
    assert sent["photos"] == [(b"jpeg", "Печать завершена")]
    assert sent["messages"] == []


def test_without_camera_message_goes_as_usual(monkeypatch, tg):
    _, sent = tg
    _camera(monkeypatch, None)
    assert notifications.notify(FakeDB(), "print_finished", "Печать завершена", printer=object())
    assert sent["photos"] == []
    assert sent["messages"] == ["Печать завершена"]


def test_broken_camera_does_not_swallow_the_message(monkeypatch, tg):
    _, sent = tg
    _camera(monkeypatch, RuntimeError("нет связи"))
    assert notifications.notify(FakeDB(), "print_finished", "Печать завершена", printer=object())
    assert sent["messages"] == ["Печать завершена"]


def test_failed_photo_send_falls_back_to_text(monkeypatch, tg):
    _, sent = tg
    _camera(monkeypatch, b"jpeg")

    def boom(*a, **kw):
        raise RuntimeError("PHOTO_INVALID_DIMENSIONS")

    monkeypatch.setattr(notifications, "send_photo", boom)
    assert notifications.notify(FakeDB(), "print_finished", "Печать завершена", printer=object())
    assert sent["messages"] == ["Печать завершена"]


def test_long_text_goes_after_the_photo(monkeypatch, tg):
    _, sent = tg
    _camera(monkeypatch, b"jpeg")
    long_text = "e" * (notifications.CAPTION_LIMIT + 1)
    assert notifications.notify(FakeDB(), "print_finished", long_text, printer=object())
    assert sent["photos"] == [(b"jpeg", "")]
    assert sent["messages"] == [long_text]


def test_photo_only_for_chosen_events(monkeypatch, tg):
    values, sent = tg
    _camera(monkeypatch, b"jpeg")
    values[notifications.PHOTO_EVENTS_KEY] = {"print_finished": False}
    assert notifications.notify(FakeDB(), "print_finished", "Печать завершена", printer=object())
    assert sent["photos"] == []
    assert sent["messages"] == ["Печать завершена"]


def test_photo_switch_off_disables_all(monkeypatch, tg):
    values, sent = tg
    _camera(monkeypatch, b"jpeg")
    values[notifications.PHOTO_ENABLED_KEY] = False
    assert notifications.notify(FakeDB(), "print_finished", "Печать завершена", printer=object())
    assert sent["photos"] == []
    assert sent["messages"] == ["Печать завершена"]


def test_non_print_events_never_carry_a_photo(monkeypatch, tg):
    _, sent = tg
    _camera(monkeypatch, b"jpeg")
    # «Катушка заканчивается» — не про печать, камере там делать нечего.
    assert notifications.notify(FakeDB(), "spool_low", "Катушка заканчивается", printer=object())
    assert sent["photos"] == []
    assert sent["messages"] == ["Катушка заканчивается"]
