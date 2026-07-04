"""Маппинг катушки Spoolman → наши поля (чистая функция, без сети)."""
from app.services.spoolman_import import map_spool

# Реальная форма записи Spoolman /api/v1/spool
SPOOLMAN_SPOOL = {
    "id": 7,
    "remaining_weight": 640.5,
    "used_weight": 359.5,
    "location": "Полка A",
    "lot_nr": "L-2231",
    "comment": "почти половина",
    "archived": False,
    "filament": {
        "id": 3,
        "name": "Galaxy Black",
        "vendor": {"name": "Prusament"},
        "material": "PLA",
        "price": 25.0,
        "density": 1.24,
        "diameter": 1.75,
        "weight": 1000.0,
        "spool_weight": 200.0,
        "article_number": "PR-PLA-BLK",
        "color_hex": "1A1A1A",
    },
}


def test_map_spool_core_fields():
    m = map_spool(SPOOLMAN_SPOOL, currency="EUR")
    assert m["manufacturer"] == "Prusament"
    assert m["material"] == "PLA"
    assert m["color_name"] == "Galaxy Black"
    assert m["color_hex"] == "#1A1A1A"
    assert m["diameter_mm"] == 1.75
    assert m["initial_filament_weight_g"] == 1000.0
    assert m["empty_spool_weight_g"] == 200.0
    assert m["current_weight_g"] == 640.5
    assert m["price"] == 25.0
    assert m["currency"] == "EUR"
    assert m["sku"] == "PR-PLA-BLK"
    assert m["notes"] == "почти половина"
    assert m["location_name"] == "Полка A"
    assert m["label"] == "Prusament Galaxy Black"
    assert m["specs"]["spoolman_id"] == 7
    assert m["specs"]["density_g_cm3"] == 1.24


def test_map_spool_remaining_from_used_when_missing():
    sp = {"id": 1, "used_weight": 300.0, "filament": {"weight": 1000.0, "material": "PETG"}}
    m = map_spool(sp)
    assert m["current_weight_g"] == 700.0  # 1000 - 300


def test_map_spool_multicolor_and_minimal():
    sp = {"id": 2, "filament": {"multi_color_hexes": "FF0000,00FF00", "material": "PLA"}}
    m = map_spool(sp)
    assert m["color_hex"] == "#FF0000"
    assert m["label"] == "PLA"  # ни вендора, ни имени
    assert m["archived"] is False
