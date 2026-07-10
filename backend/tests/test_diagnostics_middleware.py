"""Диагностический ASGI-middleware: что и когда попадает в журнал.

Запись event() (обращение к БД) подменяется — проверяем именно логику middleware
и вырезание секретов, без Postgres. Драйвим middleware напрямую как ASGI-приложение.
"""
import asyncio
import json

import pytest

from app.core.diagnostics_middleware import DiagnosticsMiddleware
from app.services import diagnostics


@pytest.fixture(autouse=True)
def _capture(monkeypatch):
    """Ловим вызовы diagnostics.event вместо записи в БД; журнал включён."""
    calls = []
    monkeypatch.setattr(diagnostics, "event", lambda *a, **k: calls.append((a, k)))
    diagnostics.set_enabled(True)
    yield calls
    diagnostics.set_enabled(False)


def _run(coro):
    return asyncio.run(coro)


async def _ok_app(scope, receive, send):
    await receive()  # downstream должен уметь прочитать тело
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b'{"ok": true}'})


def _make_app(status=200, body=b'{"ok": true}', raises=None):
    async def app(scope, receive, send):
        await receive()
        if raises is not None:
            raise raises
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": body})
    return app


async def _drive(app, *, method="POST", path="/api/spools",
                 body=b'{"name": "a"}', content_type=b"application/json"):
    mw = DiagnosticsMiddleware(app)
    scope = {"type": "http", "method": method, "path": path,
             "headers": [(b"content-type", content_type)]}
    sent = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(m):
        sent.append(m)

    await mw(scope, receive, send)
    return sent


def test_logs_mutating_request(_capture):
    sent = _run(_drive(_make_app(), body=b'{"name": "a"}'))
    # downstream отработал (ответ прошёл насквозь)
    assert any(m["type"] == "http.response.body" for m in sent)
    assert len(_capture) == 1
    args, kw = _capture[0]
    assert args == ("info", "http", None)  # level, source, message
    assert kw["method"] == "POST"
    assert kw["path"] == "/api/spools"
    assert kw["status"] == 200
    assert kw["action"] == "POST /api/spools"
    assert kw["context"]["body"] == {"name": "a"}
    assert isinstance(kw["duration_ms"], int)


def test_body_passed_through_for_redaction(_capture):
    # Секреты режет сам event() → до него тело доходит как есть; проверяем передачу.
    _run(_drive(_make_app(), body=b'{"api_key": "secret", "name": "a"}'))
    _, kw = _capture[0]
    assert kw["context"]["body"] == {"api_key": "secret", "name": "a"}


def test_sanitize_redacts_secrets():
    out = diagnostics._sanitize({"api_key": "x", "nested": {"password": "y"}, "name": "ok"})
    assert out["api_key"] == "***"
    assert out["nested"]["password"] == "***"
    assert out["name"] == "ok"


def test_error_response_captures_detail(_capture):
    body = json.dumps({"detail": "не хватает остатка"}).encode()
    _run(_drive(_make_app(status=409, body=body)))
    args, kw = _capture[0]
    assert args[0] == "warning"          # 4xx → warning
    assert kw["status"] == 409
    assert "не хватает остатка" in args[2]  # message = detail


def test_unhandled_exception_recorded_and_reraised(_capture):
    with pytest.raises(ValueError):
        _run(_drive(_make_app(raises=ValueError("boom"))))
    # record_exception внутри тоже зовёт (подменённый) event
    assert len(_capture) == 1
    args, kw = _capture[0]
    assert args[0] == "error"
    assert kw["status"] == 500
    assert "boom" in args[2]
    assert "Traceback" in kw["context"]["traceback"]


def test_get_request_not_logged(_capture):
    sent = _run(_drive(_make_app(), method="GET", path="/api/spools"))
    assert any(m["type"] == "http.response.body" for m in sent)
    assert _capture == []  # чтение не пишем


def test_diagnostics_own_requests_skipped(_capture):
    _run(_drive(_make_app(), method="POST", path="/api/diagnostics/client"))
    assert _capture == []


def test_nothing_logged_when_disabled(_capture):
    diagnostics.set_enabled(False)
    sent = _run(_drive(_make_app()))
    assert any(m["type"] == "http.response.body" for m in sent)
    assert _capture == []
