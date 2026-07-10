from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.services import diagnostics

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


class ClientError(BaseModel):
    message: str
    kind: str | None = None
    path: str | None = None
    stack: str | None = None


class LogOut(BaseModel):
    enabled: bool
    total: int
    entries: list[dict]


@router.get("/log", response_model=LogOut)
def get_log(
    level: str | None = None,
    source: str | None = None,
    q: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    entries, total = diagnostics.query(
        db, level=level, source=source, q=q, limit=limit, offset=offset
    )
    return LogOut(enabled=diagnostics.is_enabled(), total=total, entries=entries)


@router.get("/log.txt")
def download_log(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return PlainTextResponse(
        diagnostics.as_text(db),
        headers={"Content-Disposition": 'attachment; filename="filament-tracker-diagnostics.txt"'},
    )


@router.post("/clear", status_code=204)
def clear_log(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    diagnostics.clear(db)


@router.post("/client", status_code=204)
def report_client_error(err: ClientError, _: User = Depends(get_current_user)):
    """Приём ошибки из браузера. Молча игнорируется, если журнал выключен."""
    diagnostics.record_client(
        err.message, kind=err.kind, path=err.path, stack=err.stack
    )
