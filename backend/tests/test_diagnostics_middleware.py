"""Middleware записи ошибок: пишет необработанные 500 в журнал — и только когда
запись включена. Обработанные ошибки (HTTPException) в журнал не попадают.

Тест собирает крохотное FastAPI-приложение с тем же middleware, что и боевое
(app.main), — так не тянется весь граф зависимостей и не нужна БД.
"""
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.services import diagnostics


def _build_app() -> FastAPI:
    app = FastAPI()
    app.middleware("http")(diagnostics.error_capture_middleware)

    @app.get("/boom")
    def boom():
        raise ValueError("boom in test")

    @app.get("/teapot")
    def teapot():
        raise HTTPException(status_code=418, detail="nope")

    return app


@pytest.fixture(autouse=True)
def _reset():
    diagnostics.clear()
    diagnostics.set_enabled(False)
    yield
    diagnostics.clear()
    diagnostics.set_enabled(False)


def _client() -> TestClient:
    # raise_server_exceptions=False — получаем 500-ответ вместо проброса в тест.
    return TestClient(_build_app(), raise_server_exceptions=False)


def test_records_unhandled_exception_when_enabled():
    diagnostics.set_enabled(True)
    r = _client().get("/boom")
    assert r.status_code == 500

    entries = diagnostics.entries()
    assert len(entries) == 1
    e = entries[0]
    assert e["source"] == "backend"
    assert e["kind"] == "ValueError"
    assert e["method"] == "GET"
    assert e["path"] == "/boom"
    assert "boom in test" in e["message"]
    assert "Traceback" in (e["traceback"] or "")


def test_does_not_record_when_disabled():
    diagnostics.set_enabled(False)
    r = _client().get("/boom")
    assert r.status_code == 500
    assert diagnostics.entries() == []


def test_ignores_handled_http_exceptions():
    diagnostics.set_enabled(True)
    r = _client().get("/teapot")
    assert r.status_code == 418
    # Обработанная HTTPException не доходит до middleware — журнал пуст.
    assert diagnostics.entries() == []


def test_ring_buffer_is_bounded():
    diagnostics.set_enabled(True)
    for _ in range(diagnostics.MAX_ENTRIES + 50):
        diagnostics.record("backend", "x")
    assert len(diagnostics.entries()) == diagnostics.MAX_ENTRIES
