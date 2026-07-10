from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

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
    count: int
    entries: list[dict]


@router.get("/log", response_model=LogOut)
def get_log(_: User = Depends(require_admin)):
    rows = diagnostics.entries()
    return LogOut(enabled=diagnostics.is_enabled(), count=len(rows), entries=rows)


@router.get("/log.txt")
def download_log(_: User = Depends(require_admin)):
    return PlainTextResponse(
        diagnostics.as_text(),
        headers={"Content-Disposition": 'attachment; filename="filament-tracker-errors.txt"'},
    )


@router.post("/clear", status_code=204)
def clear_log(_: User = Depends(require_admin)):
    diagnostics.clear()


@router.post("/client", status_code=204)
def report_client_error(err: ClientError, _: User = Depends(get_current_user)):
    """Приём ошибки из браузера. Молча игнорируется, если запись выключена."""
    diagnostics.record(
        "frontend",
        err.message,
        kind=err.kind,
        path=err.path,
        traceback=err.stack,
    )
