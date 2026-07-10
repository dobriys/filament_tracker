"""Диагностический журнал (включается пользователем в Настройках).

Пишет и действия пользователя, и действия приложения, чтобы вылавливать
функциональные проблемы (не только падения): не сработало полу/автосписание,
не включилась сушка, не выставилось время, что-то с катушками и т.п.

Что попадает в журнал, когда он включён:
- HTTP: каждый изменяющий запрос (POST/PUT/PATCH/DELETE) — метод, путь, код
  ответа, длительность, пользователь, тело запроса (секреты вырезаются); для
  ответов с ошибкой (>=400) — текст ошибки;
- backend: необработанные исключения (500) с трассировкой;
- poller: фоновый опрос принтеров — автоимпорт/автосписание и причины отказов;
- frontend: ошибки в браузере.

Журнал общий для всех процессов (несколько uvicorn-воркеров + отдельный
поллер), поэтому хранится в БД (таблица diagnostic_events), а не в памяти.
Объём ограничивается: при вставке периодически удаляются самые старые записи
сверх MAX_ROWS. Флаг «включено» персистентный (app_settings) и кэшируется в
памяти процесса, чтобы не читать БД на каждый запрос.
"""
import traceback as _traceback

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import DiagnosticEvent

# Ключ настройки (см. settings_service) — включена ли запись.
ERROR_LOGGING_KEY = "error_logging"

# Максимум записей в журнале; при переполнении самые старые удаляются.
MAX_ROWS = 5000
# Как часто запускать чистку (раз в PRUNE_EVERY вставок).
PRUNE_EVERY = 200

# Ключи в теле запроса, значения которых нельзя писать в журнал.
_SECRET_KEYS = ("password", "api_key", "apikey", "token", "secret", "key")

_enabled: bool = False
_insert_count = 0


# --- управление флагом -------------------------------------------------------

def load_enabled(db: Session) -> None:
    """Считывает флаг из БД в кэш (старт приложения / цикл поллера)."""
    from app.services import settings_service

    set_enabled(settings_service.get_bool(db, ERROR_LOGGING_KEY, default=False))


def set_enabled(value: bool) -> None:
    global _enabled
    _enabled = bool(value)


def is_enabled() -> bool:
    return _enabled


# --- запись ------------------------------------------------------------------

def _sanitize(value):
    """Рекурсивно вырезает секреты из тела запроса перед записью в журнал."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(k, str) and any(s in k.lower() for s in _SECRET_KEYS):
                out[k] = "***"
            else:
                out[k] = _sanitize(v)
        return out
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    return value


def event(
    level: str,
    source: str,
    message: str | None = None,
    *,
    category: str | None = None,
    action: str | None = None,
    method: str | None = None,
    path: str | None = None,
    status: int | None = None,
    duration_ms: int | None = None,
    user_email: str | None = None,
    context: dict | None = None,
) -> None:
    """Пишет одну запись. Молча ничего не делает, если журнал выключен.

    Никогда не роняет вызывающий код: собственные ошибки (нет БД и т.п.)
    подавляются — журнал не должен ломать приложение. Пишет в отдельной
    короткоживущей сессии, чтобы не влиять на транзакцию запроса.
    """
    if not _enabled:
        return
    global _insert_count
    db = SessionLocal()
    try:
        db.add(
            DiagnosticEvent(
                level=level,
                source=source,
                category=category,
                action=(action or None) and action[:255],
                message=(message or None) and str(message)[:4000],
                method=method,
                path=(path or None) and path[:512],
                status=status,
                duration_ms=duration_ms,
                user_email=(user_email or None) and user_email[:255],
                context=_sanitize(context) if context else None,
            )
        )
        db.commit()
        _insert_count += 1
        if _insert_count % PRUNE_EVERY == 0:
            _prune(db)
    except Exception:  # noqa: BLE001 — журнал не должен ломать приложение
        db.rollback()
    finally:
        db.close()


def _prune(db: Session) -> None:
    """Оставляет только последние MAX_ROWS записей (по возрастанию id)."""
    cutoff = db.scalar(
        select(DiagnosticEvent.id)
        .order_by(DiagnosticEvent.id.desc())
        .offset(MAX_ROWS)
        .limit(1)
    )
    if cutoff is not None:
        db.execute(delete(DiagnosticEvent).where(DiagnosticEvent.id <= cutoff))
        db.commit()


def record_exception(exc: BaseException, *, method: str, path: str, user_email: str | None = None) -> None:
    event(
        "error",
        "backend",
        str(exc) or exc.__class__.__name__,
        category="exception",
        action=f"{method} {path}",
        method=method,
        path=path,
        status=500,
        user_email=user_email,
        context={
            "type": exc.__class__.__name__,
            "traceback": "".join(
                _traceback.format_exception(type(exc), exc, exc.__traceback__)
            )[:8000],
        },
    )


def record_client(message: str, *, kind: str | None = None, path: str | None = None, stack: str | None = None) -> None:
    event(
        "error",
        "frontend",
        message,
        category="js",
        action=kind or "error",
        path=path,
        context={"stack": stack[:8000]} if stack else None,
    )


# --- чтение ------------------------------------------------------------------

def _to_dict(e: DiagnosticEvent) -> dict:
    return {
        "id": e.id,
        "time": e.ts.isoformat(timespec="seconds") if e.ts else None,
        "level": e.level,
        "source": e.source,
        "category": e.category,
        "action": e.action,
        "message": e.message,
        "method": e.method,
        "path": e.path,
        "status": e.status,
        "duration_ms": e.duration_ms,
        "user_email": e.user_email,
        "context": e.context,
    }


def query(
    db: Session,
    *,
    level: str | None = None,
    source: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Возвращает (записи от новых к старым, всего по фильтру)."""
    stmt = select(DiagnosticEvent)
    if level:
        stmt = stmt.where(DiagnosticEvent.level == level)
    if source:
        stmt = stmt.where(DiagnosticEvent.source == source)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            DiagnosticEvent.message.ilike(like)
            | DiagnosticEvent.path.ilike(like)
            | DiagnosticEvent.action.ilike(like)
        )
    from sqlalchemy import func as _func

    count_stmt = stmt.with_only_columns(_func.count(DiagnosticEvent.id)).order_by(None)
    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.order_by(DiagnosticEvent.id.desc()).limit(limit).offset(offset)
    ).all()
    return [_to_dict(e) for e in rows], total


def clear(db: Session) -> None:
    db.execute(delete(DiagnosticEvent))
    db.commit()


def as_text(db: Session, limit: int = MAX_ROWS) -> str:
    """Журнал в виде простого текста (от старых к новым) — приложить к issue."""
    rows = db.scalars(
        select(DiagnosticEvent).order_by(DiagnosticEvent.id.desc()).limit(limit)
    ).all()
    rows = list(reversed(rows))
    if not rows:
        return "Журнал пуст.\n"
    out: list[str] = []
    for e in rows:
        ts = e.ts.isoformat(timespec="seconds") if e.ts else "?"
        head = f"[{ts}] {e.level.upper()} {e.source}"
        if e.method or e.path:
            head += f" {e.method or ''} {e.path or ''}".rstrip()
        if e.status is not None:
            head += f" -> {e.status}"
        if e.duration_ms is not None:
            head += f" ({e.duration_ms} ms)"
        if e.user_email:
            head += f" [{e.user_email}]"
        out.append(head)
        if e.message:
            out.append(f"  {e.message}")
        if e.context:
            tb = e.context.get("traceback") if isinstance(e.context, dict) else None
            if tb:
                out.append(tb.rstrip())
            else:
                out.append(f"  {e.context}")
        out.append("")
    return "\n".join(out) + "\n"
