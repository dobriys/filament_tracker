"""Маппинг и поиск каталога SpoolmanDB (чистые функции + вшитый снапшот)."""
from app.services import spoolmandb
from app.services.spoolmandb import map_entry

SAMPLE = {
    "id": "3djake_asa_black_1000_175_n",
    "manufacturer": "3DJAKE", "name": "Black", "material": "ASA",
    "density": 1.07, "weight": 1000.0, "spool_weight": 240, "diameter": 1.75,
    "color_hex": "414040",
    "extruder_temp": 250, "extruder_temp_range": [240, 260],
    "bed_temp": 100, "bed_temp_range": [90, 110],
}


def test_map_entry():
    m = map_entry(SAMPLE)
    assert m["source"] == "spoolmandb" and m["id"] is None
    assert m["catalog_id"] == "3djake_asa_black_1000_175_n"
    assert m["brand"] == "3DJAKE" and m["material"] == "ASA"
    assert m["color_hex"] == "#414040"
    assert m["density_g_cm3"] == 1.07 and m["diameter_mm"] == 1.75
    assert m["nozzle_temp_min"] == 240 and m["nozzle_temp_max"] == 260
    assert m["bed_temp_min"] == 90 and m["bed_temp_max"] == 110
    assert m["initial_filament_weight_g"] == 1000.0 and m["empty_spool_weight_g"] == 240


def test_map_entry_single_temp_no_range():
    m = map_entry({"extruder_temp": 220, "bed_temp": 60, "color_hex": None})
    assert m["nozzle_temp_min"] == 220 and m["nozzle_temp_max"] == 220
    assert m["bed_temp_min"] == 60 and m["bed_temp_max"] == 60
    assert m["color_hex"] is None


def test_search_by_query_and_material():
    spoolmandb._cache = [SAMPLE, {"manufacturer": "Bambu Lab", "name": "Basic", "material": "PLA"}]
    try:
        by_q = spoolmandb.search(db=None, q="bambu")
        assert len(by_q) == 1 and by_q[0]["brand"] == "Bambu Lab"
        by_mat = spoolmandb.search(db=None, material="asa")
        assert len(by_mat) == 1 and by_mat[0]["material"] == "ASA"
    finally:
        spoolmandb._cache = None


def test_search_brand_filter_and_sort():
    spoolmandb._cache = [
        {"manufacturer": "Zeta", "name": "Black", "material": "PLA"},
        {"manufacturer": "Alpha", "name": "White", "material": "PLA"},
        {"manufacturer": "Alpha", "name": "Red", "material": "PETG"},
    ]
    try:
        res = spoolmandb.search(db=None, brand="alpha")
        assert {r["brand"] for r in res} == {"Alpha"} and len(res) == 2
        # сортировка A→Я по бренду/материалу/имени при просмотре
        srt = spoolmandb.search(db=None, material="PLA", sort=True)
        assert [r["brand"] for r in srt] == ["Alpha", "Zeta"]
    finally:
        spoolmandb._cache = None


def test_brands_sorted_with_counts():
    spoolmandb._cache = [
        {"manufacturer": "Zeta", "name": "Black", "material": "PLA", "color_hex": "000"},
        {"manufacturer": "Alpha", "name": "White", "material": "PLA", "color_hex": "fff"},
        {"manufacturer": "Alpha", "name": "White", "material": "PLA", "color_hex": "fff"},  # дубль
    ]
    try:
        b = spoolmandb.brands(db=None)
        assert [x["brand"] for x in b] == ["Alpha", "Zeta"]
        assert b[0]["count"] == 1  # дубль схлопнут
    finally:
        spoolmandb._cache = None


def test_bundled_snapshot_present():
    spoolmandb._cache = None
    data = spoolmandb._load_bundled()
    assert isinstance(data, list) and len(data) > 100
