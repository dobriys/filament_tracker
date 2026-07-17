"""Чистые функции автоимпорта/автосписания (без БД и сети)."""
from types import SimpleNamespace

import pytest

from app.services.moonraker_sync import pick_new_jobs, resolve_slot_mappings


def _job(jid, status="completed", end=100.0, filename="a.gcode"):
    return {"job_id": jid, "status": status, "end_time": end, "filename": filename}


def test_pick_new_jobs_watermark_and_status():
    jobs = [
        _job("1", end=50),                      # старше водяного знака
        _job("2", end=150),                     # новое — берём
        _job("3", end=160, status="cancelled"), # не completed
        _job("4", end=170),                     # новое — берём
    ]
    out = pick_new_jobs(jobs, watermark=100, imported_ids=set(), consumed_names=set())
    assert [j["job_id"] for j in out] == ["2", "4"]


def test_pick_new_jobs_skips_imported_and_consumed_names():
    jobs = [
        _job("10", end=200, filename="dir/print.gcode"),
        _job("11", end=210, filename="other.gcode"),
        _job("12", end=220, filename="fresh.gcode"),
    ]
    out = pick_new_jobs(
        jobs,
        watermark=100,
        imported_ids={"10"},                 # уже импортировано
        consumed_names={"other.gcode"},      # файл уже списан вручную
    )
    assert [j["job_id"] for j in out] == ["12"]


def _slot(idx, spool=True):
    return SimpleNamespace(slot_index=idx, current_spool_id=("s" + str(idx)) if spool else None, id=f"slot{idx}")


def test_resolve_mappings_full_match():
    # tool_index (гейт) с 0, слоты с 1: гейт 2 → слот 3.
    tools = [
        {"tool_index": 0, "used_g": 0},      # нулевой расход — пропускается
        {"tool_index": 2, "used_g": 127.75},
    ]
    m = resolve_slot_mappings(tools, [_slot(1), _slot(3)])
    assert m == [{"tool_index": 2, "slot_id": "slot3"}]


def test_resolve_mappings_gate_zero_maps_to_slot_one():
    # Регресс: печать на гейте 0 должна списываться со слота 1, а не оставаться черновиком.
    tools = [{"tool_index": 0, "used_g": 85.1}]
    assert resolve_slot_mappings(tools, [_slot(1)]) == [{"tool_index": 0, "slot_id": "slot1"}]


def test_resolve_mappings_missing_slot_returns_none():
    tools = [{"tool_index": 1, "used_g": 10}]      # гейт 1 → слот 2
    assert resolve_slot_mappings(tools, [_slot(1)]) is None          # слота 2 нет
    assert resolve_slot_mappings(tools, [_slot(2, spool=False)]) is None  # слот пуст


def test_resolve_mappings_no_usage_returns_none():
    assert resolve_slot_mappings([{"tool_index": 0, "used_g": 0}], [_slot(1)]) is None


def test_resolve_mappings_uses_length_when_no_grams():
    # Fallback-tool без граммов, но с длиной — тоже маппится (граммы посчитает confirm).
    tools = [{"tool_index": 0, "used_g": None, "used_mm": 40904.0}]
    assert resolve_slot_mappings(tools, [_slot(1)]) == [{"tool_index": 0, "slot_id": "slot1"}]


def test_grams_from_length():
    from app.services.print_job_service import grams_from_length

    spool = SimpleNamespace(diameter_mm=1.75, filament_profile_id=None, material="PLA")
    # 1 м PLA 1.75 ≈ 2.98 г
    assert abs(float(grams_from_length(None, spool, 1000)) - 2.98) < 0.05
    # материал с «+» падает на базовую плотность
    spool_plus = SimpleNamespace(diameter_mm=1.75, filament_profile_id=None, material="PLA+")
    assert float(grams_from_length(None, spool_plus, 1000)) == float(grams_from_length(None, spool, 1000))


# --- сверка гейтов хаба с катушками (match_gate) ---
from app.services.moonraker import match_gate, parse_hub


def _gate(occupied=True, material="PLA+", color="#B81B0E"):
    return {"occupied": occupied, "material": material, "color_hex": color}


def test_match_gate_ok_close_color_and_material_subset():
    # хаб: PLA+ #B81B0E, катушка: PLA+/Pro #BB1E10 — совпадение
    assert match_gate(_gate(), "PLA+/Pro", "#BB1E10") == "match"


def test_match_gate_color_diff_is_soft():
    # разошёлся только оттенок — мягкий вердикт, не предупреждение
    assert match_gate(_gate(color="#FFFFFF"), "PLA+/Pro", "#000000") == "color_diff"


def test_match_gate_ok_same_color_family_across_palettes():
    # на принтере цвет выбран вручную из грубой палитры (#F40031), у катушки
    # точный цвет бренда (#bb1e10) — глазом один красный, тревожить незачем
    assert match_gate(_gate(material="ABS", color="#F40031"), "ABS+", "#bb1e10") == "match"


def test_match_gate_mismatch_material_is_hard():
    assert match_gate(_gate(material="PLA", color="#B81B0E"), "ABS", "#B81B0E") == "mismatch"


# --- базовый материал (_base_material) ---
from app.services.moonraker import _base_material


@pytest.mark.parametrize(
    "raw,base",
    [
        # вариант марки — тот же базовый материал
        ("ABS+", "ABS"),
        ("PLA+/Pro", "PLA"),
        ("PETG+", "PETG"),
        ("PETG-CF", "PETG"),
        ("PLA Silk", "PLA"),
        # PET-G — то же, что PETG, просто другое написание
        ("PET-G", "PETG"),
        # PA и Nylon — один материал под разными именами
        ("PA (Nylon)", "PA"),
        ("Nylon", "PA"),
        # разные материалы не должны схлопываться друг в друга
        ("PET", "PET"),
        ("PETG", "PETG"),
        ("PC", "PC"),
        ("PCTG", "PCTG"),
        # неизвестный материал — срезаем хотя бы маркер варианта
        ("FOO+", "FOO"),
        (None, ""),
    ],
)
def test_base_material(raw, base):
    assert _base_material(raw) == base


def test_match_gate_variant_matches_base():
    # принтер знает только грубый ABS, в приложении марка ABS+ — это совпадение
    assert match_gate(_gate(material="ABS", color="#B81B0E"), "ABS+", "#B81B0E") == "match"


def test_match_gate_near_materials_are_not_confused():
    # подстрочная проверка прятала расхождение: 'PET' in 'PETG', 'PC' in 'PCTG'
    assert match_gate(_gate(material="PET", color="#B81B0E"), "PETG", "#B81B0E") == "mismatch"
    assert match_gate(_gate(material="PC", color="#B81B0E"), "PCTG", "#B81B0E") == "mismatch"


def test_match_gate_unassigned_and_empty():
    assert match_gate(_gate(), None, None) == "unassigned"
    assert match_gate(_gate(occupied=False), None, None) == "empty"
    # катушка привязана, а принтер слот пустым видит — предупреждение
    assert match_gate(_gate(occupied=False), "PLA", "#fff") == "mismatch"


def test_parse_hub_slots_are_one_based():
    payload = {"result": {"status": {"mmu": {
        "num_gates": 2,
        "gate_status": [1, 0],
        "gate_material": ["PLA+", ""],
        "gate_color": ["B81B0EFF", ""],
        "gate_temperature": [210, 0],
    }}}}
    gates = parse_hub(payload)
    assert gates[0]["slot_index"] == 1 and gates[0]["color_hex"] == "#B81B0E"
    assert gates[1]["slot_index"] == 2 and not gates[1]["occupied"]


# --- пороги сушки по материалам ---
from app.services.spool_service import drying_threshold_days


def test_drying_thresholds():
    assert drying_threshold_days("PETG") == 21
    assert drying_threshold_days("PETG+") == 21
    assert drying_threshold_days("TPU") == 14
    assert drying_threshold_days("PA (Nylon)") == 7
    assert drying_threshold_days("PVA") == 7
    assert drying_threshold_days("ABS+") == 45
    assert drying_threshold_days("PLA+/Pro") is None   # PLA не считаем гигроскопичным
    assert drying_threshold_days(None) is None


# --- парсер сушки ACE ---
from app.services.moonraker import dryer_unit, parse_dryer


def test_parse_dryer_picks_drying_unit():
    payload = {"result": {"status": {"mmu_machine": {
        "num_units": 2,
        "unit_0": {"dryer_status": "stop", "dryer_temp": 0, "dryer_target_temp": 0,
                   "dryer_remaining": 0, "dryer_humidity": 0},
        "unit_1": {"dryer_status": "drying", "dryer_temp": 42, "dryer_target_temp": 45,
                   "dryer_remaining": 120, "dryer_humidity": 18},
    }}}}
    d = parse_dryer(payload)
    assert d["unit"] == 1 and d["status"] == "drying"
    assert d["target_temp"] == 45 and d["remaining_min"] == 120 and d["humidity"] == 18


def test_parse_dryer_reads_raw_filament_hub_duration():
    # duration — в минутах, remain_time — в секундах.
    payload = {"result": {"status": {"filament_hub": {"filament_hubs": [{
        "id": 0,
        "temp": 43,
        "humidity": 21,
        "dryer_status": {
            "status": "drying",
            "target_temp": 45,
            "duration": 240,
            "remain_time": 11880,
        },
    }]}}}}
    d = parse_dryer(payload)
    assert d["unit"] == 0 and d["status"] == "drying"
    assert d["target_temp"] == 45
    assert d["temp"] == 43
    assert d["duration_min"] == 240
    assert d["remaining_min"] == 198
    assert d["humidity"] == 21


def test_parse_dryer_merges_mmu_machine_and_filament_hub():
    # Оба объекта описывают один юнит: mmu_machine без остатка, filament_hub — с ним.
    payload = {"result": {"status": {
        "mmu_machine": {
            "num_units": 1,
            "unit_0": {"dryer_status": "drying", "dryer_temp": 0,
                       "dryer_target_temp": 45, "dryer_remaining": 0, "dryer_humidity": 0},
        },
        "filament_hub": {"filament_hubs": [{
            "id": 0,
            "temp": 45,
            "dryer_status": {"status": "drying", "target_temp": 45,
                             "duration": 360, "remain_time": 19238},
        }]},
    }}}
    d = parse_dryer(payload)
    assert d["unit"] == 0 and d["status"] == "drying"
    assert d["target_temp"] == 45 and d["temp"] == 45
    assert d["duration_min"] == 360
    assert d["remaining_min"] == 321


def test_parse_dryer_none_without_hub():
    assert parse_dryer({"result": {"status": {}}}) is None


def test_dryer_unit_uses_active_unit_unless_requested():
    dryer = {"unit": 1, "status": "drying"}
    assert dryer_unit(dryer) == 1
    assert dryer_unit(dryer, requested=2) == 2
    assert dryer_unit(None) == 0


# --- автоопределение возможностей + пресеты ---
from app.services.moonraker import detect_capabilities
from app.services.printer_presets import PRESETS, get_preset


def test_detect_capabilities_from_hub_and_dryer():
    gates = [{"gate": 0}, {"gate": 1}, {"gate": 2}, {"gate": 3}]
    caps = detect_capabilities(gates, {"status": "stop"})
    assert caps == {"has_mmu": True, "mmu_slots": 4, "has_dryer": True}


def test_detect_capabilities_plain_printer():
    assert detect_capabilities([], None) == {}


def test_printer_presets_have_required_fields():
    assert get_preset("anycubic-kobra-s1-combo")["capabilities"]["mmu_slots"] == 4
    assert get_preset("missing") is None
    for p in PRESETS:
        assert {"key", "integration_type", "capabilities"} <= p.keys()
