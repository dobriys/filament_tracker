import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import CostEstimate, Printer, User
from app.schemas.cost_estimate import (
    CostEstimateCreate,
    CostEstimateListItem,
    CostEstimateOut,
    CostEstimateUpdate,
)
from app.services import cost_service

router = APIRouter(prefix="/cost-estimates", tags=["cost-estimates"])


def _own(db: Session, user: User, estimate_id: uuid.UUID) -> CostEstimate:
    est = db.get(CostEstimate, estimate_id)
    if est is None or est.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Расчёт не найден")
    return est


def _printer(db: Session, user: User, printer_id: uuid.UUID | None) -> Printer | None:
    if printer_id is None:
        return None
    printer = db.get(Printer, printer_id)
    if printer is None or printer.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Принтер не найден")
    return printer


def _apply(db: Session, user: User, est: CostEstimate) -> None:
    """Заполнить тарифы, если их не прислали, и пересчитать итоги.

    Итоги считает сервер, а не форма: иначе сохранённой цене нельзя было бы
    верить. Тарифы после первого сохранения не трогаем — они заморожены
    вместе с расчётом (см. модель); обновить их можно, прислав inputs.rates
    заново, что и делает кнопка «Пересчитать по тарифам принтера».
    """
    code = cost_service.validate_currency(est.currency)
    est.currency = code
    inputs = dict(est.inputs or {})
    if not inputs.get("rates"):
        inputs["rates"] = cost_service.printer_rates(_printer(db, user, est.printer_id))
    # Валюта расчёта одна: и подпись сумм, и то, в чём заданы тарифы.
    inputs["currency"] = code
    est.inputs = inputs
    est.totals = cost_service.compute(inputs)
    est.landed_cost = round(est.totals["landed_total"], 2)


@router.get("", response_model=list[CostEstimateListItem])
def list_estimates(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return list(
        db.scalars(
            select(CostEstimate)
            .where(CostEstimate.owner_user_id == user.id)
            .order_by(CostEstimate.updated_at.desc())
        )
    )


@router.post("", response_model=CostEstimateOut, status_code=status.HTTP_201_CREATED)
def create_estimate(
    data: CostEstimateCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _printer(db, user, data.printer_id)  # чужой принтер в расчёт не пустим
    est = CostEstimate(owner_user_id=user.id, totals={}, landed_cost=0, **data.model_dump())
    _apply(db, user, est)
    db.add(est)
    db.commit()
    db.refresh(est)
    return est


@router.get("/{estimate_id}", response_model=CostEstimateOut)
def get_estimate(
    estimate_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _own(db, user, estimate_id)


@router.patch("/{estimate_id}", response_model=CostEstimateOut)
def update_estimate(
    estimate_id: uuid.UUID,
    data: CostEstimateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    est = _own(db, user, estimate_id)
    fields = data.model_dump(exclude_unset=True)
    if fields.get("printer_id") is not None:
        _printer(db, user, fields["printer_id"])
    for key, value in fields.items():
        setattr(est, key, value)
    _apply(db, user, est)
    db.commit()
    db.refresh(est)
    return est


@router.delete("/{estimate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_estimate(
    estimate_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.delete(_own(db, user, estimate_id))
    db.commit()
