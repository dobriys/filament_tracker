"""Импорт катушек из Spoolman (self-hosted инвентарь филамента, REST API /api/v1).

Тянем список катушек, маппим модель Spoolman на нашу и создаём катушки. Разбор
(map_spool) — чистая функция, тестируется без сети.
"""
import json

import httpx

DEFAULT_TIMEOUT = 10.0


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _hex(fil: dict):
    raw = fil.get("color_hex")
    if not raw:
        multi = fil.get("multi_color_hexes")
        raw = (multi or "").split(",")[0] if multi else None
    if not raw:
        return None
    raw = str(raw).lstrip("#")
    return f"#{raw[:6]}" if len(raw) >= 6 else None


def map_spool(sp: dict, *, currency: str | None = None) -> dict:
    """Одна катушка Spoolman → данные для spool_service.create_spool."""
    fil = sp.get("filament") or {}
    vendor = (fil.get("vendor") or {}).get("name")
    material = fil.get("material")
    name = fil.get("name")

    initial = _num(fil.get("weight"))          # нетто полной катушки, г
    empty = _num(fil.get("spool_weight"))      # вес пустой катушки, г
    remaining = _num(sp.get("remaining_weight"))
    used = _num(sp.get("used_weight"))
    if remaining is None and initial is not None and used is not None:
        remaining = max(0.0, initial - used)
    if remaining is None:
        remaining = initial

    price = _num(sp.get("price"))
    if price is None:
        price = _num(fil.get("price"))

    specs: dict = {"spoolman_id": sp.get("id")}
    dens = _num(fil.get("density"))
    if dens:
        specs["density_g_cm3"] = dens

    label = " ".join(x for x in [vendor, name] if x) or name or material or "Spool"

    return {
        "label": label,
        "manufacturer": vendor,
        "material": material,
        "color_name": name,
        "color_hex": _hex(fil),
        "diameter_mm": _num(fil.get("diameter")),
        "initial_filament_weight_g": initial,
        "empty_spool_weight_g": empty,
        "current_weight_g": remaining,
        "price": price,
        "currency": currency,
        "sku": fil.get("article_number") or sp.get("lot_nr") or None,
        "notes": sp.get("comment") or None,
        "location_name": (sp.get("location") or "").strip() or None,
        "archived": bool(sp.get("archived")),
        "specs": specs,
    }


def fetch(base_url: str) -> tuple[list[dict], str | None]:
    """Список катушек + настроенная валюта из Spoolman. Возвращает (spools, currency)."""
    base = base_url.rstrip("/")
    with httpx.Client(timeout=DEFAULT_TIMEOUT, follow_redirects=True) as client:
        r = client.get(f"{base}/api/v1/spool")
        r.raise_for_status()
        spools = r.json()
        currency = None
        try:
            cr = client.get(f"{base}/api/v1/setting/currency")
            if cr.status_code == 200:
                val = (cr.json() or {}).get("value")
                currency = json.loads(val) if isinstance(val, str) else val
        except Exception:
            pass
    return spools, currency
