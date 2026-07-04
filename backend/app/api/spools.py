import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import Printer, PrinterSlot, Spool, SpoolEvent, User
from app.schemas.spool import (
    AdjustRequest,
    MoveRequest,
    SpoolCreate,
    SpoolEventOut,
    SpoolOut,
    SpoolUpdate,
    WeighRequest,
)
from app.services import label_service, spool_service


class LabelsRequest(BaseModel):
    spool_ids: list[uuid.UUID]
    size: str = "classic"
    fields: list[str] | None = None

router = APIRouter(prefix="/spools", tags=["spools"])


def _own(db: Session, user: User, spool_id: uuid.UUID) -> Spool:
    spool = db.get(Spool, spool_id)
    if spool is None or spool.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Катушка не найдена")
    return spool


@router.get("", response_model=list[SpoolOut])
def list_spools(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    status_filter: str | None = None,
):
    stmt = select(Spool).where(Spool.owner_user_id == user.id)
    if status_filter:
        stmt = stmt.where(Spool.status == status_filter)
    return list(db.scalars(stmt.order_by(Spool.created_at.desc())))


@router.post("", response_model=SpoolOut, status_code=status.HTTP_201_CREATED)
def create_spool(
    data: SpoolCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return spool_service.create_spool(db, owner=user, data=data.model_dump())


class SpoolmanImportRequest(BaseModel):
    url: str
    include_archived: bool = False


def _find_or_create_location(db: Session, user: User, name: str, cache: dict) -> uuid.UUID:
    from app.models import Location

    if name in cache:
        return cache[name]
    loc = db.scalar(
        select(Location).where(Location.owner_user_id == user.id, Location.name == name)
    )
    if loc is None:
        loc = Location(owner_user_id=user.id, name=name)
        db.add(loc)
        db.flush()
    cache[name] = loc.id
    return loc.id


@router.post("/import-spoolman")
def import_spoolman(
    data: SpoolmanImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Импорт катушек из внешнего Spoolman по URL. Идемпотентно: повторный импорт
    пропускает уже завезённые (по spoolman_id в specs)."""
    from app.services import spoolman_import

    try:
        spools, currency = spoolman_import.fetch(data.url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Spoolman недоступен: {e}")
    if not isinstance(spools, list):
        raise HTTPException(status_code=502, detail="Неожиданный ответ Spoolman")

    existing = {
        (s.specs or {}).get("spoolman_id")
        for s in db.scalars(select(Spool).where(Spool.owner_user_id == user.id))
    }
    imported = skipped = 0
    loc_cache: dict = {}
    for raw in spools:
        m = spoolman_import.map_spool(raw, currency=currency)
        archived = m.pop("archived", False)
        loc_name = m.pop("location_name", None)
        sid = m["specs"].get("spoolman_id")
        if (archived and not data.include_archived) or (sid is not None and sid in existing):
            skipped += 1
            continue
        if loc_name:
            m["location_id"] = _find_or_create_location(db, user, loc_name, loc_cache)
        spool_service.create_spool(db, owner=user, data=m)
        if sid is not None:
            existing.add(sid)
        imported += 1
    return {"imported": imported, "skipped": skipped, "total": len(spools)}


@router.get("/label-options")
def label_options(_: User = Depends(get_current_user)):
    """Доступные размеры этикеток и каталог полей для печати."""
    return {
        "sizes": [
            {"key": k, "width_mm": w, "height_mm": h}
            for k, (w, h) in label_service.SIZE_PRESETS.items()
        ],
        "fields": [
            {"key": k, "label": label}
            for k, (label, _g) in label_service.FIELD_CATALOG.items()
        ],
        "default_fields": label_service.DEFAULT_FIELDS,
    }


@router.get("/{spool_id}", response_model=SpoolOut)
def get_spool(
    spool_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _own(db, user, spool_id)


@router.get("/{spool_id}/placement")
def spool_placement(
    spool_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Где сейчас катушка: место хранения и/или слот принтера."""
    spool = _own(db, user, spool_id)
    location_name = None
    if spool.location_id:
        from app.models import Location

        loc = db.get(Location, spool.location_id)
        location_name = loc.name if loc else None
    slot = db.scalar(select(PrinterSlot).where(PrinterSlot.current_spool_id == spool.id))
    slot_info = None
    if slot is not None:
        printer = db.get(Printer, slot.printer_id)
        slot_info = {
            "slot_id": str(slot.id),
            "printer_id": str(slot.printer_id),
            "printer_name": printer.name if printer else None,
            "slot_index": slot.slot_index,
            "slot_name": slot.name,
        }
    return {
        "location_id": str(spool.location_id) if spool.location_id else None,
        "location_name": location_name,
        "slot": slot_info,
    }


@router.patch("/{spool_id}", response_model=SpoolOut)
def update_spool(
    spool_id: uuid.UUID,
    data: SpoolUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(spool, k, v)
    # при ручной правке остатка пересчитываем статус
    spool_service.recompute_status(spool)
    db.commit()
    db.refresh(spool)
    return spool


@router.delete("/{spool_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_spool(
    spool_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    # Убираем зависимости в строгом порядке (core-запросы выполняются сразу).
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    from app.models import (
        PrintJobSpoolUsage,
        SlotAssignmentHistory,
        Spool as SpoolModel,
    )

    db.execute(
        sa_update(PrinterSlot).where(PrinterSlot.current_spool_id == spool.id).values(current_spool_id=None)
    )
    db.execute(
        sa_update(SlotAssignmentHistory).where(SlotAssignmentHistory.spool_id == spool.id).values(spool_id=None)
    )
    db.execute(sa_delete(PrintJobSpoolUsage).where(PrintJobSpoolUsage.spool_id == spool.id))
    db.execute(sa_delete(SpoolEvent).where(SpoolEvent.spool_id == spool.id))
    db.execute(sa_delete(SpoolModel).where(SpoolModel.id == spool.id))
    db.commit()


DUPLICATE_FIELDS = [
    "filament_profile_id", "location_id", "label", "sku", "manufacturer",
    "barcode", "photo", "material", "color_name", "color_hex", "diameter_mm",
    "hotend_temp", "bed_temp", "fan_speed", "flow_rate", "specs",
    "initial_filament_weight_g", "empty_spool_weight_g", "current_weight_g",
    "purchase_date", "opened_date", "price", "currency", "notes",
]


@router.post("/{spool_id}/duplicate", response_model=SpoolOut, status_code=status.HTTP_201_CREATED)
def duplicate_spool(
    spool_id: uuid.UUID,
    new_color: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Дублирует катушку (новый qr-токен, статус «новая»). С new_color=true
    очищает цвет, чтобы задать другой вариант того же филамента."""
    src = _own(db, user, spool_id)
    data = {f: getattr(src, f) for f in DUPLICATE_FIELDS}
    if new_color:
        data["color_name"] = None
        data["color_hex"] = None
    return spool_service.create_spool(db, owner=user, data=data)


@router.post("/{spool_id}/weigh", response_model=SpoolOut)
def weigh_spool(
    spool_id: uuid.UUID,
    data: WeighRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    return spool_service.weigh(
        db, spool, total_weight_g=data.total_weight_g, user=user, reason=data.reason
    )


@router.post("/{spool_id}/adjust", response_model=SpoolOut)
def adjust_spool(
    spool_id: uuid.UUID,
    data: AdjustRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    try:
        return spool_service.adjust(
            db,
            spool,
            delta_g=data.delta_g,
            new_weight_g=data.new_weight_g,
            user=user,
            reason=data.reason,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class DryRequest(BaseModel):
    temp_c: float | None = None
    hours: float | None = None


@router.post("/{spool_id}/dry", response_model=SpoolOut)
def dry_spool(
    spool_id: uuid.UUID,
    data: DryRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Отметить катушку просушенной (журнал сушек + сброс напоминания)."""
    spool = _own(db, user, spool_id)
    return spool_service.dry(db, spool, user=user, temp_c=data.temp_c, hours=data.hours)


@router.post("/{spool_id}/move", response_model=SpoolOut)
def move_spool(
    spool_id: uuid.UUID,
    data: MoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    return spool_service.move(
        db, spool, location_id=data.location_id, user=user, reason=data.reason
    )


@router.get("/{spool_id}/events", response_model=list[SpoolEventOut])
def spool_events(
    spool_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _own(db, user, spool_id)
    return list(
        db.scalars(
            select(SpoolEvent)
            .where(SpoolEvent.spool_id == spool_id)
            .order_by(SpoolEvent.created_at.desc())
        )
    )


# --- QR и печатные карточки ---
@router.get("/by-qr/{qr_token}")
def spool_by_qr(
    qr_token: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Резолв QR-токена в данные карточки (приватная страница катушки)."""
    spool = db.scalar(select(Spool).where(Spool.qr_token == qr_token))
    if spool is None or spool.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Катушка не найдена")
    return label_service.build_card_data(db, spool)


@router.get("/{spool_id}/card")
def spool_card(
    spool_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return label_service.build_card_data(db, _own(db, user, spool_id))


@router.get("/{spool_id}/qr.png")
def spool_qr_png(
    spool_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    return Response(
        content=label_service.qr_png_bytes(spool.qr_token), media_type="image/png"
    )


@router.get("/{spool_id}/label.png")
def spool_label_png(
    spool_id: uuid.UUID,
    size: str = "classic",
    fields: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    field_list = [f for f in fields.split(",") if f] if fields else None
    png = label_service.single_label_png(db, spool, size=size, fields=field_list)
    return Response(content=png, media_type="image/png")


@router.get("/{spool_id}/label.pdf")
def spool_label_pdf(
    spool_id: uuid.UUID,
    size: str = "classic",
    fields: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spool = _own(db, user, spool_id)
    field_list = [f for f in fields.split(",") if f] if fields else None
    pdf = label_service.single_label_pdf(db, spool, size=size, fields=field_list)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="spool-{spool_id}.pdf"'},
    )


@router.post("/labels.pdf")
def spools_labels_a4(
    data: LabelsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    spools = [
        s
        for sid in data.spool_ids
        if (s := db.get(Spool, sid)) is not None and s.owner_user_id == user.id
    ]
    if not spools:
        raise HTTPException(status_code=404, detail="Катушки не найдены")
    pdf = label_service.a4_labels_pdf(db, spools, size=data.size, fields=data.fields)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="labels-a4.pdf"'},
    )
