"""Экспорт/импорт профилей и полный бэкап/восстановление данных пользователя.

Экспорт — JSON со всеми данными пользователя. Восстановление заменяет инвентарь
(места, профили, катушки, принтеры, слоты, события): прежние данные удаляются, из
файла создаются новые с новыми id и ремаппингом ссылок.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import (
    FilamentProfile,
    Location,
    Printer,
    PrinterSlot,
    PrintJob,
    PrintJobSpoolUsage,
    PrintJobToolUsage,
    SlotAssignmentHistory,
    Spool,
    SpoolEvent,
    User,
)
from app.core.security import decrypt_secret, encrypt_secret
from app.services import settings_service
from app.services.spool_service import generate_qr_token

EXPORT_VERSION = 2

# Поля профиля, которые переносятся (без id/owner/служебных меток времени).
PROFILE_FIELDS = [
    "brand", "name", "material", "color_name", "color_hex", "diameter_mm",
    "density_g_cm3", "nozzle_temp_min", "nozzle_temp_max", "bed_temp_min",
    "bed_temp_max", "flow_ratio", "pressure_advance", "fan_percent",
    "print_speed_mm_s", "max_volumetric_speed", "notes", "source_name", "source_url",
    "specs",
]


def _json_safe(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row_to_dict(obj, columns) -> dict:
    return {c: _json_safe(getattr(obj, c)) for c in columns}


# ---------- Профили: экспорт/импорт ----------
def serialize_profile(p: FilamentProfile) -> dict:
    return _row_to_dict(p, PROFILE_FIELDS)


def export_profiles(db: Session, user: User, scope: str = "mine") -> list[dict]:
    stmt = select(FilamentProfile)
    if scope == "mine":
        stmt = stmt.where(FilamentProfile.owner_user_id == user.id)
    elif scope == "public":
        stmt = stmt.where(FilamentProfile.is_public.is_(True))
    # scope == "all" -> и свои, и публичные
    elif scope == "all":
        stmt = stmt.where(
            (FilamentProfile.owner_user_id == user.id)
            | (FilamentProfile.is_public.is_(True))
        )
    return [serialize_profile(p) for p in db.scalars(stmt.order_by(FilamentProfile.name))]


def import_profiles(db: Session, user: User, items: list[dict]) -> int:
    count = 0
    for item in items:
        data = {k: item.get(k) for k in PROFILE_FIELDS if k in item}
        if not data.get("name") or not data.get("material"):
            continue  # обязательные поля
        db.add(FilamentProfile(owner_user_id=user.id, is_public=False, **data))
        count += 1
    db.commit()
    return count


# ---------- Полный бэкап ----------
LOCATION_COLS = ["name", "parent_id", "description"]
SPOOL_COLS = [
    "filament_profile_id", "location_id", "label", "sku", "manufacturer",
    "barcode", "photo", "material", "color_name", "color_hex", "diameter_mm",
    "hotend_temp", "bed_temp", "fan_speed", "flow_rate", "specs",
    "initial_filament_weight_g", "empty_spool_weight_g", "current_weight_g",
    "purchase_date", "opened_date", "price", "currency", "status", "notes",
    "qr_token",
]
PRINTJOB_COLS = [
    "source", "file_name", "file_hash", "slicer_name", "slicer_version",
    "estimated_print_time_sec", "filament_change_count",
    "total_filament_used_g", "total_filament_used_mm", "status",
    "parsed_metadata", "completed_at", "created_at",
]
TOOL_USAGE_COLS = [
    "tool_index", "slot_index", "material", "color_hex", "used_g", "used_mm",
    "parsed_metadata",
]
SPOOL_USAGE_COLS = [
    "spool_id", "tool_index", "used_g", "used_mm", "confirmed_at", "created_at",
]
# ключ настройки → её значение по умолчанию (важно для корректного экспорта,
# когда настройка ни разу не менялась и строки в БД нет)
SETTINGS_DEFAULTS = {
    "allow_negative_consumption": False,
    "moonraker_auto_import": True,
    "moonraker_auto_consume": False,
}
PRINTER_COLS = ["name", "integration_type", "brand", "model", "capabilities", "moonraker_url", "is_active", "notes"]
SLOT_COLS = ["slot_index", "name", "current_spool_id", "is_active"]
EVENT_COLS = [
    "spool_id", "event_type", "weight_before_g", "weight_after_g", "delta_g",
    "reason", "event_metadata", "created_at",
]


def full_backup(db: Session, user: User) -> dict:
    locations = list(db.scalars(select(Location).where(Location.owner_user_id == user.id)))
    profiles = list(db.scalars(select(FilamentProfile).where(FilamentProfile.owner_user_id == user.id)))
    spools = list(db.scalars(select(Spool).where(Spool.owner_user_id == user.id)))
    spool_ids = [s.id for s in spools]
    printers = list(db.scalars(select(Printer).where(Printer.owner_user_id == user.id)))
    printer_ids = [p.id for p in printers]
    slots = list(
        db.scalars(select(PrinterSlot).where(PrinterSlot.printer_id.in_(printer_ids)))
    ) if printer_ids else []
    events = list(
        db.scalars(select(SpoolEvent).where(SpoolEvent.spool_id.in_(spool_ids)))
    ) if spool_ids else []
    jobs = list(db.scalars(select(PrintJob).where(PrintJob.owner_user_id == user.id)))
    job_ids = [j.id for j in jobs]
    tool_usage = list(
        db.scalars(select(PrintJobToolUsage).where(PrintJobToolUsage.print_job_id.in_(job_ids)))
    ) if job_ids else []
    spool_usage = list(
        db.scalars(select(PrintJobSpoolUsage).where(PrintJobSpoolUsage.print_job_id.in_(job_ids)))
    ) if job_ids else []

    return {
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {"email": user.email},
        "locations": [dict(_row_to_dict(x, LOCATION_COLS), id=str(x.id)) for x in locations],
        "filament_profiles": [
            dict(serialize_profile(x), id=str(x.id), is_public=x.is_public) for x in profiles
        ],
        "spools": [dict(_row_to_dict(x, SPOOL_COLS), id=str(x.id)) for x in spools],
        "spool_events": [_row_to_dict(x, EVENT_COLS) for x in events],
        "printers": [
            dict(
                _row_to_dict(x, PRINTER_COLS),
                id=str(x.id),
                # ключ в бэкапе в открытом виде: файл принадлежит пользователю,
                # а на другом сервере другой ENCRYPTION_KEY
                moonraker_api_key=(
                    decrypt_secret(x.moonraker_api_key_encrypted)
                    if x.moonraker_api_key_encrypted
                    else None
                ),
            )
            for x in printers
        ],
        "printer_slots": [dict(_row_to_dict(x, SLOT_COLS), id=str(x.id), printer_id=str(x.printer_id)) for x in slots],
        "print_jobs": [
            dict(_row_to_dict(x, PRINTJOB_COLS), id=str(x.id), printer_id=_json_safe(x.printer_id))
            for x in jobs
        ],
        "print_job_tool_usage": [
            dict(_row_to_dict(x, TOOL_USAGE_COLS), print_job_id=str(x.print_job_id)) for x in tool_usage
        ],
        "print_job_spool_usage": [
            dict(_row_to_dict(x, SPOOL_USAGE_COLS), print_job_id=str(x.print_job_id)) for x in spool_usage
        ],
        "settings": {k: settings_service.get_bool(db, k, default=d) for k, d in SETTINGS_DEFAULTS.items()},
    }


def wipe_user_data(db: Session, user: User) -> None:
    """Удаляет инвентарь пользователя (без commit — вызывается внутри restore).

    Сносим ровно то, что переносит full_backup, чтобы восстановление давало
    состояние из файла, а не сумму с прежним. Публичный каталог
    (owner_user_id IS NULL) не трогаем — он не принадлежит пользователю.

    Порядок важен: ни один FK не объявлен с ON DELETE CASCADE, поэтому сначала
    дети, потом родители — иначе БД отвергнет удаление.
    """
    my_jobs = select(PrintJob.id).where(PrintJob.owner_user_id == user.id)
    my_printers = select(Printer.id).where(Printer.owner_user_id == user.id)
    my_slots = select(PrinterSlot.id).where(PrinterSlot.printer_id.in_(my_printers))
    my_spools = select(Spool.id).where(Spool.owner_user_id == user.id)

    db.execute(
        delete(PrintJobSpoolUsage).where(
            PrintJobSpoolUsage.print_job_id.in_(my_jobs)
            | PrintJobSpoolUsage.spool_id.in_(my_spools)
        )
    )
    db.execute(delete(PrintJobToolUsage).where(PrintJobToolUsage.print_job_id.in_(my_jobs)))
    db.execute(delete(PrintJob).where(PrintJob.owner_user_id == user.id))
    # История назначений слотов в бэкап не входит, но ссылается на слоты и
    # катушки — без её удаления снос упрётся в FK.
    db.execute(
        delete(SlotAssignmentHistory).where(
            SlotAssignmentHistory.printer_slot_id.in_(my_slots)
            | SlotAssignmentHistory.spool_id.in_(my_spools)
        )
    )
    db.execute(delete(PrinterSlot).where(PrinterSlot.printer_id.in_(my_printers)))
    db.execute(delete(Printer).where(Printer.owner_user_id == user.id))
    db.execute(delete(SpoolEvent).where(SpoolEvent.spool_id.in_(my_spools)))
    db.execute(delete(Spool).where(Spool.owner_user_id == user.id))
    db.execute(delete(FilamentProfile).where(FilamentProfile.owner_user_id == user.id))
    # Место хранения ссылается на место же (parent_id) — обнуляем связи заранее,
    # чтобы удаление не зависело от порядка строк внутри таблицы.
    db.execute(
        update(Location).where(Location.owner_user_id == user.id).values(parent_id=None)
    )
    db.execute(delete(Location).where(Location.owner_user_id == user.id))


def restore_backup(db: Session, user: User, data: dict) -> dict:
    """Заменяет инвентарь пользователя данными из бэкапа.

    Прежние данные удаляются: состояние после восстановления — ровно то, что в
    файле. Снос и создание идут одной транзакцией, поэтому сбой на любом шаге
    откатывает всё и оставляет прежние данные нетронутыми.
    """
    wipe_user_data(db, user)

    loc_map: dict[str, uuid.UUID] = {}
    prof_map: dict[str, uuid.UUID] = {}
    spool_map: dict[str, uuid.UUID] = {}
    printer_map: dict[str, uuid.UUID] = {}

    # Места хранения (двумя проходами ради parent_id)
    for item in data.get("locations", []):
        loc = Location(
            owner_user_id=user.id,
            name=item.get("name") or "Без названия",
            description=item.get("description"),
        )
        db.add(loc)
        db.flush()
        loc_map[item["id"]] = loc.id
    for item in data.get("locations", []):
        parent = item.get("parent_id")
        if parent and parent in loc_map:
            db.get(Location, loc_map[item["id"]]).parent_id = loc_map[parent]

    # Профили
    for item in data.get("filament_profiles", []):
        fields = {k: item.get(k) for k in PROFILE_FIELDS if k in item}
        p = FilamentProfile(owner_user_id=user.id, is_public=bool(item.get("is_public")), **fields)
        db.add(p)
        db.flush()
        prof_map[item["id"]] = p.id

    # Катушки (QR-токен сохраняем, если он свободен — старые этикетки продолжат работать)
    for item in data.get("spools", []):
        token = item.get("qr_token")
        if not token or db.scalar(select(Spool).where(Spool.qr_token == token)) is not None:
            token = generate_qr_token()
        s = Spool(
            owner_user_id=user.id,
            filament_profile_id=prof_map.get(item.get("filament_profile_id")),
            location_id=loc_map.get(item.get("location_id")),
            label=item.get("label"),
            sku=item.get("sku"),
            manufacturer=item.get("manufacturer"),
            barcode=item.get("barcode"),
            photo=item.get("photo"),
            material=item.get("material"),
            color_name=item.get("color_name"),
            color_hex=item.get("color_hex"),
            diameter_mm=item.get("diameter_mm"),
            hotend_temp=item.get("hotend_temp"),
            bed_temp=item.get("bed_temp"),
            fan_speed=item.get("fan_speed"),
            flow_rate=item.get("flow_rate"),
            specs=item.get("specs"),
            initial_filament_weight_g=item.get("initial_filament_weight_g"),
            empty_spool_weight_g=item.get("empty_spool_weight_g"),
            current_weight_g=item.get("current_weight_g") or 0,
            purchase_date=_parse_date(item.get("purchase_date")),
            opened_date=_parse_date(item.get("opened_date")),
            price=item.get("price"),
            currency=item.get("currency") or "RUB",
            status=item.get("status") or "new",
            notes=item.get("notes"),
            qr_token=token,
        )
        db.add(s)
        db.flush()
        spool_map[item["id"]] = s.id

    # События катушек
    for item in data.get("spool_events", []):
        sid = spool_map.get(item.get("spool_id"))
        if sid is None:
            continue
        ev = SpoolEvent(
            spool_id=sid,
            user_id=user.id,
            event_type=item.get("event_type") or "manual_adjustment",
            weight_before_g=item.get("weight_before_g"),
            weight_after_g=item.get("weight_after_g"),
            delta_g=item.get("delta_g"),
            reason=item.get("reason"),
            event_metadata=item.get("event_metadata"),
        )
        created = _parse_dt(item.get("created_at"))
        if created:
            ev.created_at = created
        db.add(ev)

    # Принтеры
    for item in data.get("printers", []):
        pr = Printer(
            owner_user_id=user.id,
            name=item.get("name") or "Принтер",
            integration_type=item.get("integration_type") or "manual",
            brand=item.get("brand"),
            model=item.get("model"),
            capabilities=item.get("capabilities") or {},
            moonraker_url=item.get("moonraker_url"),
            moonraker_api_key_encrypted=(
                encrypt_secret(item["moonraker_api_key"])
                if item.get("moonraker_api_key")
                else None
            ),
            is_active=bool(item.get("is_active", True)),
            notes=item.get("notes"),
        )
        db.add(pr)
        db.flush()
        printer_map[item["id"]] = pr.id

    # Слоты
    for item in data.get("printer_slots", []):
        pid = printer_map.get(item.get("printer_id"))
        if pid is None:
            continue
        db.add(
            PrinterSlot(
                printer_id=pid,
                slot_index=item.get("slot_index") or 1,
                name=item.get("name"),
                current_spool_id=spool_map.get(item.get("current_spool_id")),
                is_active=bool(item.get("is_active", True)),
            )
        )

    # История печати
    job_map: dict[str, uuid.UUID] = {}
    for item in data.get("print_jobs", []):
        job = PrintJob(
            owner_user_id=user.id,
            printer_id=printer_map.get(item.get("printer_id")),
            source=item.get("source") or "manual_upload",
            file_name=item.get("file_name"),
            file_hash=item.get("file_hash"),
            slicer_name=item.get("slicer_name"),
            slicer_version=item.get("slicer_version"),
            estimated_print_time_sec=item.get("estimated_print_time_sec"),
            filament_change_count=item.get("filament_change_count"),
            total_filament_used_g=item.get("total_filament_used_g"),
            total_filament_used_mm=item.get("total_filament_used_mm"),
            status=item.get("status") or "draft",
            parsed_metadata=item.get("parsed_metadata"),
            completed_at=_parse_dt(item.get("completed_at")),
        )
        created = _parse_dt(item.get("created_at"))
        if created:
            job.created_at = created
        db.add(job)
        db.flush()
        job_map[item["id"]] = job.id

    for item in data.get("print_job_tool_usage", []):
        jid = job_map.get(item.get("print_job_id"))
        if jid is None:
            continue
        db.add(
            PrintJobToolUsage(
                print_job_id=jid,
                tool_index=item.get("tool_index") or 0,
                slot_index=item.get("slot_index"),
                material=item.get("material"),
                color_hex=item.get("color_hex"),
                used_g=item.get("used_g"),
                used_mm=item.get("used_mm"),
                parsed_metadata=item.get("parsed_metadata"),
            )
        )

    for item in data.get("print_job_spool_usage", []):
        jid = job_map.get(item.get("print_job_id"))
        sid = spool_map.get(item.get("spool_id"))
        if jid is None or sid is None:
            continue
        db.add(
            PrintJobSpoolUsage(
                print_job_id=jid,
                spool_id=sid,
                tool_index=item.get("tool_index"),
                used_g=item.get("used_g") or 0,
                used_mm=item.get("used_mm"),
                confirmed_by_user_id=user.id,
                confirmed_at=_parse_dt(item.get("confirmed_at")),
            )
        )

    # Настройки приложения
    for key, value in (data.get("settings") or {}).items():
        if key in SETTINGS_DEFAULTS:
            settings_service.set_value(db, key, bool(value))

    db.commit()
    return {
        "locations": len(loc_map),
        "filament_profiles": len(prof_map),
        "spools": len(spool_map),
        "printers": len(printer_map),
        "print_jobs": len(job_map),
    }


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None
