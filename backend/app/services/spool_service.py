"""Единая точка изменения остатка катушки.

Любая операция, меняющая вес (ручная корректировка, взвешивание, списание
печатью), проходит через _record_change, чтобы spool_events оставался
консистентным журналом. Этот же паттерн переиспользуется на Этапе 3 при
списании по gcode.
"""
import secrets
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Spool, SpoolEvent, User

# Порог, ниже которого катушка считается «почти закончилась» (граммы пластика).
LOW_THRESHOLD_G = Decimal("50")


def price_per_gram(db: Session, spool_ids: list) -> dict:
    """Цена за грамм по катушкам: {spool_id: (ppg, currency)}.

    Цена делится на вес филамента **на момент заведения катушки** (weight_after_g
    события created) — так початая катушка, купленная с частичным остатком, не
    занижает себестоимость. Для катушек без события created (старые/импорт из
    бэкапа) — запасной вариант: вес нетто полной катушки.
    Катушки без цены или без веса в ответ не попадают.
    """
    if not spool_ids:
        return {}
    created_w: dict = {}
    rows = db.execute(
        select(SpoolEvent.spool_id, SpoolEvent.weight_after_g).where(
            SpoolEvent.spool_id.in_(spool_ids),
            SpoolEvent.event_type == "created",
        )
    ).all()
    for sid, w in rows:
        created_w[sid] = w
    out: dict = {}
    for spool in db.scalars(select(Spool).where(Spool.id.in_(spool_ids))):
        if spool.price is None:
            continue
        paid_w = created_w.get(spool.id) or spool.initial_filament_weight_g
        if not paid_w or float(paid_w) <= 0:
            continue
        out[spool.id] = (float(spool.price) / float(paid_w), spool.currency)
    return out


def generate_qr_token() -> str:
    """Непредсказуемый токен — НЕ id катушки, чтобы по ссылке нельзя было перебирать."""
    return secrets.token_urlsafe(16)


def filament_left_g(spool: Spool) -> Decimal:
    """Сколько пластика осталось (current_weight трактуем как вес пластика)."""
    return Decimal(spool.current_weight_g)


def recompute_status(spool: Spool) -> None:
    if spool.status == "archived":
        return
    left = filament_left_g(spool)
    if left <= 0:
        spool.status = "empty"
    elif left <= LOW_THRESHOLD_G:
        spool.status = "almost_empty"
    elif spool.status in ("new",):
        # не трогаем «new», пока пользователь сам не начнёт печатать
        pass
    else:
        spool.status = "in_use"


def _record_change(
    db: Session,
    spool: Spool,
    *,
    event_type: str,
    new_weight: Decimal,
    user: User | None,
    reason: str | None = None,
    metadata: dict | None = None,
) -> SpoolEvent:
    before = Decimal(spool.current_weight_g)
    after = Decimal(new_weight)
    spool.current_weight_g = after
    recompute_status(spool)

    event = SpoolEvent(
        spool_id=spool.id,
        user_id=user.id if user else None,
        event_type=event_type,
        weight_before_g=before,
        weight_after_g=after,
        delta_g=after - before,
        reason=reason,
        event_metadata=metadata,
    )
    db.add(event)
    return event


def create_spool(
    db: Session,
    *,
    owner: User,
    data: dict,
) -> Spool:
    current = data.get("current_weight_g")
    if current is None:
        current = data.get("initial_filament_weight_g") or Decimal("0")

    spool = Spool(
        owner_user_id=owner.id,
        filament_profile_id=data.get("filament_profile_id"),
        location_id=data.get("location_id"),
        label=data.get("label"),
        sku=data.get("sku"),
        manufacturer=data.get("manufacturer"),
        barcode=data.get("barcode"),
        photo=data.get("photo"),
        material=data.get("material"),
        color_name=data.get("color_name"),
        color_hex=data.get("color_hex"),
        diameter_mm=data.get("diameter_mm"),
        hotend_temp=data.get("hotend_temp"),
        bed_temp=data.get("bed_temp"),
        fan_speed=data.get("fan_speed"),
        flow_rate=data.get("flow_rate"),
        specs=data.get("specs"),
        initial_filament_weight_g=data.get("initial_filament_weight_g"),
        empty_spool_weight_g=data.get("empty_spool_weight_g"),
        current_weight_g=current,
        purchase_date=data.get("purchase_date"),
        opened_date=data.get("opened_date"),
        price=data.get("price"),
        currency=data.get("currency") or "RUB",
        notes=data.get("notes"),
        status="new",
        qr_token=generate_qr_token(),
    )
    db.add(spool)
    db.flush()  # получить spool.id

    db.add(
        SpoolEvent(
            spool_id=spool.id,
            user_id=owner.id,
            event_type="created",
            weight_before_g=None,
            weight_after_g=spool.current_weight_g,
            delta_g=None,
            reason="Катушка создана",
        )
    )
    db.commit()
    db.refresh(spool)
    return spool


def weigh(
    db: Session, spool: Spool, *, total_weight_g: Decimal, user: User, reason=None
) -> Spool:
    """Пользователь вводит общий вес катушки, считаем остаток пластика."""
    empty = Decimal(spool.empty_spool_weight_g or 0)
    new_filament = Decimal(total_weight_g) - empty
    if new_filament < 0:
        new_filament = Decimal("0")
    _record_change(
        db,
        spool,
        event_type="weighed",
        new_weight=new_filament,
        user=user,
        reason=reason,
        metadata={"total_weight_g": str(total_weight_g), "empty_spool_weight_g": str(empty)},
    )
    db.commit()
    db.refresh(spool)
    return spool


def adjust(
    db: Session,
    spool: Spool,
    *,
    delta_g: Decimal | None,
    new_weight_g: Decimal | None,
    user: User,
    reason=None,
) -> Spool:
    if new_weight_g is not None:
        target = Decimal(new_weight_g)
    elif delta_g is not None:
        target = Decimal(spool.current_weight_g) + Decimal(delta_g)
    else:
        raise ValueError("Нужно указать delta_g или new_weight_g")
    if target < 0:
        target = Decimal("0")
    _record_change(
        db,
        spool,
        event_type="manual_adjustment",
        new_weight=target,
        user=user,
        reason=reason,
    )
    db.commit()
    db.refresh(spool)
    return spool


def consume(
    db: Session,
    spool: Spool,
    *,
    used_g: Decimal,
    user: User,
    reason=None,
    metadata: dict | None = None,
    commit: bool = True,
) -> SpoolEvent:
    """Списать use_g граммов с катушки (печать). Может уйти в минус — проверку
    достаточности делает вызывающий код (print_job_service). Здесь только
    фиксируем изменение и пишем событие print_usage."""
    target = Decimal(spool.current_weight_g) - Decimal(used_g)
    event = _record_change(
        db,
        spool,
        event_type="print_usage",
        new_weight=target,
        user=user,
        reason=reason,
        metadata=metadata,
    )
    if commit:
        db.commit()
        db.refresh(spool)
    return event


def dry(
    db: Session,
    spool: Spool,
    *,
    user: User,
    temp_c: float | None = None,
    hours: float | None = None,
) -> Spool:
    """Отметка «катушка просушена» — событие в журнале, вес не меняется."""
    parts = []
    if temp_c:
        parts.append(f"{temp_c:g}°C")
    if hours:
        parts.append(f"{hours:g} ч")
    reason = "Сушка" + (f" {', '.join(parts)}" if parts else "")
    db.add(
        SpoolEvent(
            spool_id=spool.id,
            user_id=user.id,
            event_type="dried",
            weight_before_g=spool.current_weight_g,
            weight_after_g=spool.current_weight_g,
            delta_g=None,
            reason=reason,
            event_metadata={"temp_c": temp_c, "hours": hours},
        )
    )
    db.commit()
    db.refresh(spool)
    return spool


# Гигроскопичность: через сколько дней без сушки напоминать (по материалу).
HYGROSCOPIC_DAYS = [
    ("PVA", 7), ("PA", 7), ("NYLON", 7),
    ("TPU", 14),
    ("PETG", 21),
    ("ABS", 45), ("ASA", 45),
]


def drying_threshold_days(material: str | None) -> int | None:
    """Сколько дней материал может лежать без сушки; None — не гигроскопичен."""
    m = (material or "").upper()
    for token, days in HYGROSCOPIC_DAYS:
        if m.startswith(token) or (token == "NYLON" and "NYLON" in m):
            return days
    return None


def move(db: Session, spool: Spool, *, location_id, user: User, reason=None) -> Spool:
    old_location = spool.location_id
    spool.location_id = location_id
    db.add(
        SpoolEvent(
            spool_id=spool.id,
            user_id=user.id,
            event_type="moved",
            weight_before_g=spool.current_weight_g,
            weight_after_g=spool.current_weight_g,
            delta_g=Decimal("0"),
            reason=reason,
            event_metadata={
                "from_location_id": str(old_location) if old_location else None,
                "to_location_id": str(location_id) if location_id else None,
            },
        )
    )
    db.commit()
    db.refresh(spool)
    return spool
