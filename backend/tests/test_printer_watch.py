"""Переходы состояния принтера → события уведомлений (без БД и сети)."""
from app.services.printer_watch import diff, snapshot


def _snap(state=None, dryer=None, online=True, filename=None, message=None):
    return snapshot(
        {"state": state, "filename": filename, "message": message},
        {"status": "running"} if dryer else {"status": "stop"},
        online=online,
    )


def _events(prev, cur):
    return [e for e, _ in diff(prev, cur, "Kobra")]


def test_print_state_transitions():
    assert _events(_snap("standby"), _snap("printing")) == ["print_started"]
    assert _events(_snap("printing"), _snap("complete")) == ["print_finished"]
    assert _events(_snap("printing"), _snap("paused")) == ["print_paused"]
    assert _events(_snap("printing"), _snap("cancelled")) == ["print_cancelled"]


def test_no_event_without_change():
    assert _events(_snap("printing"), _snap("printing")) == []
    assert _events(_snap("complete"), _snap("complete")) == []


def test_error_includes_firmware_message():
    _, text = diff(_snap("printing"), _snap("error", message="Lost communication"), "Kobra")[0]
    assert "Ошибка печати" in text
    assert "Lost communication" in text


def test_filename_included_when_known():
    _, text = diff(_snap("standby"), _snap("printing", filename="cube.gcode"), "Kobra")[0]
    assert "cube.gcode" in text


def test_dryer_start_and_finish():
    assert _events(_snap("standby"), _snap("standby", dryer=True)) == ["dryer_started"]
    assert _events(_snap("standby", dryer=True), _snap("standby")) == ["dryer_finished"]


def test_offline_suppresses_other_events():
    # Уходя в офлайн, остальные поля недостоверны — только одно событие.
    assert _events(_snap("printing"), _snap("error", online=False)) == ["printer_offline"]
    # И пока принтер офлайн, ничего больше не шлём.
    assert _events(_snap("printing", online=False), _snap("printing", online=False)) == []


def test_back_online_reports_once():
    assert _events(_snap("printing", online=False), _snap("printing")) == ["printer_offline"]


def test_snapshot_treats_idle_dryer_statuses_as_off():
    for status in ("stop", "idle", "off", ""):
        assert snapshot({}, {"status": status}, online=True)["dryer"] is False
    assert snapshot({}, {"status": "running"}, online=True)["dryer"] is True
