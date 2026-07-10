"""Диагностический журнал ошибок (включается пользователем в Настройках).

Инструмент для отладки: когда что-то ломается, администратор включает запись,
воспроизводит проблему, скачивает журнал и прикладывает его к issue на GitHub.

Ошибки хранятся в кольцевом буфере в памяти процесса (последние MAX_ENTRIES),
а не в БД: это временные диагностические данные, они сами вытесняются и
очищаются при перезапуске. Флаг «включено» персистентный (в app_settings),
но кэшируется здесь, чтобы middleware не ходило в БД на каждый запрос.
"""
import threading
import traceback as _traceback
from collections import deque
from datetime import datetime, timezone

from sqlalchemy.orm import Session

# Ключ настройки (см. settings_service) — включена ли запись ошибок.
ERROR_LOGGING_KEY = "error_logging"

MAX_ENTRIES = 500

_lock = threading.Lock()
_entries: deque[dict] = deque(maxlen=MAX_ENTRIES)
_enabled: bool = False


def load_enabled(db: Session) -> None:
    """Считывает флаг из БД в кэш (вызывается на старте приложения)."""
    from app.services import settings_service

    set_enabled(settings_service.get_bool(db, ERROR_LOGGING_KEY, default=False))


def set_enabled(value: bool) -> None:
    global _enabled
    _enabled = bool(value)


def is_enabled() -> bool:
    return _enabled


def record(
    source: str,
    message: str,
    *,
    kind: str | None = None,
    method: str | None = None,
    path: str | None = None,
    traceback: str | None = None,
) -> None:
    """Добавляет запись в журнал. Молча игнорирует, если запись выключена."""
    if not _enabled:
        return
    entry = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,  # "backend" | "frontend"
        "kind": kind,       # тип ошибки/исключения
        "message": (message or "")[:2000],
        "method": method,
        "path": path,
        "traceback": (traceback or "")[:8000] or None,
    }
    with _lock:
        _entries.append(entry)


def record_exception(exc: BaseException, *, method: str, path: str) -> None:
    record(
        "backend",
        str(exc) or exc.__class__.__name__,
        kind=exc.__class__.__name__,
        method=method,
        path=path,
        traceback="".join(
            _traceback.format_exception(type(exc), exc, exc.__traceback__)
        ),
    )


async def error_capture_middleware(request, call_next):
    """HTTP-middleware: пишет необработанные исключения в журнал и пробрасывает их.

    Поведение ответа не меняется — исключение обрабатывается штатно (500).
    Обработанные ошибки (HTTPException и т.п.) сюда не доходят: их перехватывает
    внутренний ExceptionMiddleware до этого слоя. Запись игнорируется, если
    журнал выключен (см. record_exception → record).
    """
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001 — логируем и пробрасываем
        record_exception(exc, method=request.method, path=request.url.path)
        raise


def entries() -> list[dict]:
    with _lock:
        return list(_entries)


def clear() -> None:
    with _lock:
        _entries.clear()


def as_text() -> str:
    """Журнал в виде простого текста — удобно приложить к issue."""
    rows = entries()
    if not rows:
        return "Журнал пуст.\n"
    out: list[str] = []
    for e in rows:
        head = f"[{e['time']}] {e['source']}"
        if e.get("method") or e.get("path"):
            head += f" {e.get('method') or ''} {e.get('path') or ''}".rstrip()
        if e.get("kind"):
            head += f" — {e['kind']}"
        out.append(head)
        if e.get("message"):
            out.append(f"  {e['message']}")
        if e.get("traceback"):
            out.append(e["traceback"].rstrip())
        out.append("")
    return "\n".join(out) + "\n"
