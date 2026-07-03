"""Контекст текущего HTTP-запроса (per-request, через contextvars).

Хранит origin, с которого пользователь открыл интерфейс, — чтобы QR-коды и
прочие абсолютные ссылки строились от реального адреса сервера (IP в локалке,
домен за прокси) без ручной настройки FRONTEND_BASE_URL.
"""
from contextvars import ContextVar

_frontend_origin: ContextVar[str | None] = ContextVar("frontend_origin", default=None)


def set_frontend_origin(origin: str | None):
    return _frontend_origin.set(origin)


def get_frontend_origin() -> str | None:
    return _frontend_origin.get()
