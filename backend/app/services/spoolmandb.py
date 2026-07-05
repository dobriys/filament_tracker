"""Каталог филамента из SpoolmanDB (https://github.com/Donkie/SpoolmanDB, MIT).

Снапшот filaments.json вшит в образ (`app/data/spoolmandb_filaments.json`), работает
офлайн. Опционально обновляется с GitHub Pages и кэшируется в AppSetting. Данные —
только для автозаполнения профиля/катушки; выбор конкретной записи делает пользователь.
"""
import json
import os
import time

import httpx

from sqlalchemy.orm import Session

from app.models import AppSetting

URL = "https://donkie.github.io/SpoolmanDB/filaments.json"
SNAPSHOT_KEY = "spoolmandb_snapshot"
_BUNDLED = os.path.join(os.path.dirname(__file__), "..", "data", "spoolmandb_filaments.json")

_cache: list | None = None  # распарсенный список записей (bundled или обновлённый)


def _load_bundled() -> list:
    with open(os.path.normpath(_BUNDLED), encoding="utf-8") as f:
        return json.load(f)


def _entries(db: Session) -> list:
    """Записи каталога: обновлённый снапшот из БД, иначе вшитый. Кэшируется в процессе."""
    global _cache
    if _cache is None:
        row = db.get(AppSetting, SNAPSHOT_KEY)
        data = row.value.get("value") if row is not None and isinstance(row.value, dict) else None
        _cache = data if isinstance(data, list) else _load_bundled()
    return _cache


def _range(single, rng):
    if isinstance(rng, (list, tuple)) and len(rng) == 2 and all(v is not None for v in rng):
        return rng[0], rng[1]
    return single, single


def map_entry(e: dict) -> dict:
    """Запись SpoolmanDB → форма, совместимая с pickCatalog на фронте."""
    n_min, n_max = _range(e.get("extruder_temp"), e.get("extruder_temp_range"))
    b_min, b_max = _range(e.get("bed_temp"), e.get("bed_temp_range"))
    ch = e.get("color_hex")
    return {
        "source": "spoolmandb",
        "catalog_id": e.get("id"),
        "id": None,  # не локальный профиль — линковать нечего
        "brand": e.get("manufacturer"),
        "name": e.get("name"),
        "material": e.get("material"),
        "color_name": e.get("name"),
        "color_hex": f"#{ch}" if ch else None,
        "density_g_cm3": e.get("density"),
        "diameter_mm": e.get("diameter"),
        "nozzle_temp_min": n_min,
        "nozzle_temp_max": n_max,
        "bed_temp_min": b_min,
        "bed_temp_max": b_max,
        "initial_filament_weight_g": e.get("weight"),
        "empty_spool_weight_g": e.get("spool_weight"),
    }


def search(
    db: Session,
    q: str | None = None,
    material: str | None = None,
    brand: str | None = None,
    limit: int = 20,
    sort: bool = False,
) -> list[dict]:
    # По словам (AND), чтобы «prusament pla» находило запись, где между брендом и
    # материалом стоит название цвета.
    tokens = (q or "").strip().lower().split()
    mat = (material or "").strip().upper()
    br = (brand or "").strip().lower()
    out, seen = [], set()
    for e in _entries(db):
        if mat and (e.get("material") or "").upper() != mat:
            continue
        if br and (e.get("manufacturer") or "").strip().lower() != br:
            continue
        if tokens:
            hay = f"{e.get('manufacturer', '')} {e.get('name', '')} {e.get('material', '')}".lower()
            if not all(tok in hay for tok in tokens):
                continue
        # схлопываем варианты одной модели (разные вес/диаметр) — для автозаполнения шум
        key = (e.get("manufacturer"), e.get("name"), e.get("material"), e.get("color_hex"))
        if key in seen:
            continue
        seen.add(key)
        out.append(map_entry(e))
        if not sort and len(out) >= limit:
            break
    if sort:
        out.sort(key=lambda x: ((x["brand"] or "").lower(), (x["material"] or ""), (x["name"] or "").lower()))
        out = out[:limit]
    return out


def brands(db: Session) -> list[dict]:
    """Бренды каталога с числом моделей, отсортированы A→Я."""
    counts: dict[str, set] = {}
    for e in _entries(db):
        b = (e.get("manufacturer") or "").strip()
        if not b:
            continue
        key = (e.get("name"), e.get("material"), e.get("color_hex"))
        counts.setdefault(b, set()).add(key)
    return [
        {"brand": b, "count": len(v)}
        for b, v in sorted(counts.items(), key=lambda kv: kv[0].lower())
    ]


def info(db: Session) -> dict:
    row = db.get(AppSetting, SNAPSHOT_KEY)
    updated = row.value.get("updated_at") if row is not None and isinstance(row.value, dict) else None
    return {"count": len(_entries(db)), "updated_at": updated}


def refresh(db: Session) -> int:
    """Скачать свежий filaments.json и закэшировать в БД."""
    global _cache
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        r = client.get(URL)
        r.raise_for_status()
        data = r.json()
    if not isinstance(data, list) or not data:
        raise ValueError("Неожиданный формат SpoolmanDB")
    row = db.get(AppSetting, SNAPSHOT_KEY)
    payload = {"value": data, "updated_at": time.time()}
    if row is None:
        db.add(AppSetting(key=SNAPSHOT_KEY, value=payload))
    else:
        row.value = payload
    db.commit()
    _cache = data
    return len(data)
