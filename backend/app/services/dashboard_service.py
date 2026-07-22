"""Агрегаты для главной панели (дашборда)."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    FilamentProfile,
    PrintJob,
    PrintJobSpoolUsage,
    Spool,
    SpoolEvent,
    User,
)
from app.services import spool_service

MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

# Грубая оценка: сколько грамм филамента уходит на час печати.
GRAMS_PER_HOUR = 55

ACTIVITY_TYPE = {
    "created": "added",
    "print_usage": "used",
    "manual_adjustment": "updated",
    "weighed": "updated",
    "moved": "moved",
    "archived": "updated",
    "dried": "updated",
}


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _profile_name(p: FilamentProfile | None, spool: Spool) -> str:
    brand = spool.manufacturer or (p.brand if p else None)
    name = (p.name if p else None) or spool.label
    # не дублируем бренд, если название уже начинается с него
    if brand and name and name.lower().startswith(brand.lower()):
        brand = None
    return " ".join(filter(None, [brand, name])) or "Без метки"


def build(db: Session, user: User) -> dict:
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    since_30 = now - timedelta(days=30)

    spools = list(db.scalars(select(Spool).where(Spool.owner_user_id == user.id)))
    prof_ids = {s.filament_profile_id for s in spools if s.filament_profile_id}
    profiles = (
        {p.id: p for p in db.scalars(select(FilamentProfile).where(FilamentProfile.id.in_(prof_ids)))}
        if prof_ids
        else {}
    )
    spool_map = {s.id: s for s in spools}

    active = [s for s in spools if s.status != "archived"]
    est_left = sum(float(s.current_weight_g) for s in active)
    low = [s for s in active if s.status in ("almost_empty", "empty")]
    added_this_month = sum(1 for s in spools if _aware(s.created_at) >= month_start)

    # --- события ---
    spool_ids = [s.id for s in spools]
    events = (
        list(
            db.scalars(
                select(SpoolEvent)
                .where(SpoolEvent.spool_id.in_(spool_ids))
                .order_by(SpoolEvent.created_at.desc())
            )
        )
        if spool_ids
        else []
    )

    # --- расход по месяцам (последние 6) + за 30 дней ---
    last6 = [_shift_month(now.year, now.month, -i) for i in range(5, -1, -1)]
    usage_by_month: dict[tuple[int, int], float] = defaultdict(float)
    # тот же расход, но разложенный по материалу катушки — для стопочных столбиков
    usage_by_month_mat: dict[tuple[int, int], dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    consumed_30 = 0.0
    for ev in events:
        if ev.event_type == "print_usage" and ev.delta_g is not None:
            g = max(0.0, -float(ev.delta_g))
            ts = _aware(ev.created_at)
            usage_by_month[(ts.year, ts.month)] += g
            sp = spool_map.get(ev.spool_id)
            prof = profiles.get(sp.filament_profile_id) if sp else None
            material = (
                (sp.material if sp else None)
                or (prof.material if prof else None)
                or "Прочее"
            )
            usage_by_month_mat[(ts.year, ts.month)][material] += g
            if ts >= since_30:
                consumed_30 += g
    monthly_usage = [
        {
            "label": MONTHS_RU[m - 1],
            "grams": round(usage_by_month.get((y, m), 0.0)),
            "by_material": {
                k: round(v) for k, v in usage_by_month_mat.get((y, m), {}).items()
            },
        }
        for (y, m) in last6
    ]

    # --- стоимость расхода за 30 дней (цена за грамм — spool_service.price_per_gram) ---
    cost_rows = db.execute(
        select(PrintJobSpoolUsage.spool_id, PrintJobSpoolUsage.used_g)
        .join(PrintJob, PrintJob.id == PrintJobSpoolUsage.print_job_id)
        .where(
            PrintJob.owner_user_id == user.id,
            PrintJobSpoolUsage.confirmed_at >= since_30,
        )
    ).all()
    ppg = spool_service.price_per_gram(db, list({r[0] for r in cost_rows}))
    consumed_30_cost = 0.0
    cost_currency = None
    for spool_id, used_g in cost_rows:
        p = ppg.get(spool_id)
        if p is None:
            continue
        consumed_30_cost += float(used_g) * p[0]
        cost_currency = cost_currency or p[1]

    # --- печатей за 30 дней (и сколько из них брак) ---
    recent_jobs = list(
        db.scalars(
            select(PrintJob).where(
                PrintJob.owner_user_id == user.id,
                PrintJob.status == "consumed",
                PrintJob.completed_at >= since_30,
            )
        )
    )
    recent_prints = len(recent_jobs)
    failed_30 = sum(1 for j in recent_jobs if (j.parsed_metadata or {}).get("failed"))

    # --- распределение по материалам ---
    mat: dict[str, float] = defaultdict(float)
    for s in active:
        p = profiles.get(s.filament_profile_id)
        material = s.material or (p.material if p else None) or "Прочее"
        mat[material] += float(s.current_weight_g)
    material_distribution = sorted(
        [{"material": k, "grams": round(v)} for k, v in mat.items()],
        key=lambda x: -x["grams"],
    )

    # --- мало осталось: только катушки на исходе/пустые, самые маленькие первыми ---
    low_sorted = sorted(low, key=lambda s: float(s.current_weight_g))[:4]
    low_stock = []
    for s in low_sorted:
        p = profiles.get(s.filament_profile_id)
        capacity = float(s.initial_filament_weight_g or 0) or 1000.0
        remaining = float(s.current_weight_g)
        low_stock.append(
            {
                "id": str(s.id),
                "name": _profile_name(p, s),
                "sub": s.color_name or (p.color_name if p else None) or s.label or "",
                "color_hex": s.color_hex or (p.color_hex if p else None),
                "remaining_g": round(remaining),
                "pct": max(0.0, min(1.0, remaining / capacity)) if capacity else 0,
            }
        )

    # --- сушка: гигроскопичные материалы без сушки дольше порога ---
    last_dried: dict = {}
    for ev in events:
        if ev.event_type == "dried" and ev.spool_id not in last_dried:
            last_dried[ev.spool_id] = _aware(ev.created_at)  # events отсортированы по убыванию
    drying_alerts = []
    for s in active:
        if float(s.current_weight_g) <= 0:
            continue
        prof = profiles.get(s.filament_profile_id)
        material = s.material or (prof.material if prof else None)
        threshold = spool_service.drying_threshold_days(material)
        if threshold is None:
            continue
        ref = last_dried.get(s.id)
        if ref is None:
            opened = getattr(s, "opened_date", None)
            if opened is not None:
                ref = datetime(opened.year, opened.month, opened.day, tzinfo=timezone.utc)
            else:
                ref = _aware(s.created_at)
        days = (now - ref).days
        if days >= threshold:
            drying_alerts.append(
                {
                    "id": str(s.id),
                    "name": _profile_name(prof, s),
                    "material": material,
                    "days": days,
                    "threshold": threshold,
                }
            )
    drying_alerts.sort(key=lambda x: -x["days"])

    # --- последняя активность (до 6) ---
    recent_activity = []
    for ev in events[:6]:
        s = spool_map.get(ev.spool_id)
        if s is None:
            continue
        p = profiles.get(s.filament_profile_id) if s else None
        kind = ACTIVITY_TYPE.get(ev.event_type, "updated")
        amount = None
        if ev.event_type == "print_usage" and ev.delta_g is not None:
            amount = f"{ev.delta_g:.0f}g"
        elif ev.event_type == "created" and ev.weight_after_g is not None:
            amount = f"+{ev.weight_after_g:.0f}g"
        elif ev.delta_g is not None and float(ev.delta_g) != 0:
            amount = f"{'+' if float(ev.delta_g) > 0 else ''}{ev.delta_g:.0f}g"
        recent_activity.append(
            {
                "type": kind,
                "name": _profile_name(p, s),
                "sub": ev.reason or {"created": "Новая катушка", "moved": "Перемещение"}.get(ev.event_type, ""),
                "amount": amount,
                "created_at": _aware(ev.created_at).isoformat(),
            }
        )

    return {
        "total_spools": len(active),
        "added_this_month": added_this_month,
        "low_stock_count": len(low),
        "est_filament_left_g": round(est_left),
        "est_print_hours": round(est_left / GRAMS_PER_HOUR) if est_left else 0,
        "recent_prints_30d": recent_prints,
        "failed_30d": failed_30,
        "drying_alerts": drying_alerts[:5],
        "consumed_30d_g": round(consumed_30),
        "consumed_30d_cost": round(consumed_30_cost, 2) if consumed_30_cost else None,
        "cost_currency": cost_currency,
        "monthly_usage": monthly_usage,
        "material_distribution": material_distribution,
        "low_stock": low_stock,
        "recent_activity": recent_activity,
    }


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
