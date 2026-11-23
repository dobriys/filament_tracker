import time
import uuid

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import (
    Printer,
    PrintJob,
    PrintJobSpoolUsage,
    User,
)
from app.schemas.print_job import (
    ConfirmUsageRequest,
    PrintJobCreate,
    PrintJobDetailOut,
    PrintJobOut,
    SpoolUsageOut,
    ToolUsageOut,
)
from app.services import moonraker_sync, print_job_service

router = APIRouter(prefix="/print-jobs", tags=["print-jobs"])


def _own(db: Session, user: User, job_id: uuid.UUID) -> PrintJob:
    job = db.get(PrintJob, job_id)
    if job is None or job.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Печать не найдена")
    return job


def _thumbnail_available(db: Session, ids: list) -> set:
    """Печати, у которых миниатюра есть или может найтись на принтере.

    Саму картинку (десятки КБ) список не тянет — колонка отложенная, а здесь
    только условие: есть data_url, либо печать с принтера ещё не проверяли.
    """
    if not ids:
        return set()
    return set(
        db.scalars(
            select(PrintJob.id).where(
                PrintJob.id.in_(ids),
                or_(
                    PrintJob.thumbnail.has_key("data_url"),
                    and_(
                        PrintJob.thumbnail.is_(None),
                        PrintJob.source == "moonraker",
                        PrintJob.printer_id.is_not(None),
                    ),
                ),
            )
        )
    )


def _apply_extras(
    out: PrintJobOut, job: PrintJob, costs: dict, consumed: dict | None = None,
    thumbs: set | None = None,
) -> PrintJobOut:
    out.failed = bool((job.parsed_metadata or {}).get("failed"))
    out.thumbnail_available = job.id in (thumbs or set())
    out.consumed_g = (consumed or {}).get(out.id)
    c = costs.get(out.id)
    if c:
        out.cost = round(c["cost"], 2)
        out.cost_currency = c["currency"]
        out.cost_partial = c["partial"]
    return out


def _detail(db: Session, job: PrintJob) -> PrintJobDetailOut:
    tools = print_job_service.tool_usage(db, job)
    usage = list(
        db.scalars(
            select(PrintJobSpoolUsage).where(PrintJobSpoolUsage.print_job_id == job.id)
        )
    )
    base = PrintJobOut.model_validate(job).model_dump()
    detail = PrintJobDetailOut(
        **base,
        tools=[ToolUsageOut.model_validate(t) for t in tools],
        spool_usage=[SpoolUsageOut.model_validate(u) for u in usage],
    )
    return _apply_extras(
        detail,
        job,
        print_job_service.jobs_cost(db, [job.id]),
        print_job_service.jobs_consumed_g(db, [job.id]),
        _thumbnail_available(db, [job.id]),
    )


@router.get("", response_model=list[PrintJobOut])
def list_jobs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    jobs = list(
        db.scalars(
            select(PrintJob)
            .where(PrintJob.owner_user_id == user.id)
            .order_by(PrintJob.created_at.desc())
        )
    )
    ids = [j.id for j in jobs]
    costs = print_job_service.jobs_cost(db, ids)
    consumed = print_job_service.jobs_consumed_g(db, ids)
    thumbs = _thumbnail_available(db, ids)
    return [_apply_extras(PrintJobOut.model_validate(j), j, costs, consumed, thumbs) for j in jobs]


# Принтер не ответил — несколько минут не спрашиваем его снова: иначе каждая
# строка истории ждала бы свой таймаут. {printer_id: monotonic-время}.
_PRINTER_OFFLINE: dict = {}
_OFFLINE_RETRY_SEC = 120.0


@router.get("/{job_id}/thumbnail")
def job_thumbnail(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Миниатюра модели {"thumbnail": {data_url, width, height} | null}.

    У печатей, импортированных до появления миниатюр (или пока принтер был
    недоступен), картинку дозапрашиваем у принтера один раз и запоминаем —
    и найденную, и её отсутствие. Не ответил принтер — спросим в другой раз.
    """
    job = _own(db, user, job_id)
    th = job.thumbnail
    if th is None and job.source == "moonraker" and job.printer_id and job.file_name:
        printer = db.get(Printer, job.printer_id)
        if printer is not None and printer.integration_type == "moonraker" and printer.moonraker_url:
            if time.monotonic() < _PRINTER_OFFLINE.get(printer.id, 0):
                return {"thumbnail": None}
            try:
                th = moonraker_sync.client_for(printer).fetch_thumbnail(job.file_name) or {}
            except Exception:
                _PRINTER_OFFLINE[printer.id] = time.monotonic() + _OFFLINE_RETRY_SEC
                return {"thumbnail": None}
            job.thumbnail = th
            db.commit()
    return {"thumbnail": th if th and th.get("data_url") else None}


@router.post("", response_model=PrintJobDetailOut, status_code=status.HTTP_201_CREATED)
def create_job(
    data: PrintJobCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if data.printer_id is not None:
        printer = db.get(Printer, data.printer_id)
        if printer is None or printer.owner_user_id != user.id:
            raise HTTPException(status_code=404, detail="Принтер не найден")
    job = print_job_service.create_from_parsed(
        db, owner=user, printer_id=data.printer_id, parsed=data.parsed.model_dump()
    )
    return _detail(db, job)


@router.get("/{job_id}", response_model=PrintJobDetailOut)
def get_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _detail(db, _own(db, user, job_id))


@router.post("/{job_id}/confirm-usage", response_model=PrintJobDetailOut)
def confirm_usage(
    job_id: uuid.UUID,
    data: ConfirmUsageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = _own(db, user, job_id)
    try:
        job = print_job_service.confirm_usage(
            db,
            job,
            user=user,
            mappings=[m.model_dump() for m in data.mappings],
            allow_negative_requested=data.allow_negative,
        )
    except print_job_service.ConsumptionError as e:
        raise HTTPException(status_code=409, detail=e.problems)
    return _detail(db, job)


class MarkFailedRequest(BaseModel):
    failed: bool = True


@router.post("/{job_id}/mark-failed", response_model=PrintJobDetailOut)
def mark_failed(
    job_id: uuid.UUID,
    data: MarkFailedRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Пометить списанную печать как брак (или снять пометку)."""
    job = _own(db, user, job_id)
    if job.status != "consumed":
        raise HTTPException(status_code=409, detail="Отметить браком можно только списанную печать")
    job.parsed_metadata = {**(job.parsed_metadata or {}), "failed": data.failed}
    db.commit()
    db.refresh(job)
    return _detail(db, job)


@router.post("/{job_id}/cancel", response_model=PrintJobOut)
def cancel_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = _own(db, user, job_id)
    try:
        return print_job_service.cancel(db, job)
    except print_job_service.ConsumptionError as e:
        raise HTTPException(status_code=409, detail=e.problems)
