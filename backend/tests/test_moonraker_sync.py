"""Чистые функции автоимпорта/автосписания (без БД и сети)."""
from types import SimpleNamespace

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
    tools = [
        {"tool_index": 0, "used_g": 0},      # нулевой расход — пропускается
        {"tool_index": 2, "used_g": 127.75},
    ]
    m = resolve_slot_mappings(tools, [_slot(0), _slot(2)])
    assert m == [{"tool_index": 2, "slot_id": "slot2"}]


def test_resolve_mappings_missing_slot_returns_none():
    tools = [{"tool_index": 1, "used_g": 10}]
    assert resolve_slot_mappings(tools, [_slot(0)]) is None          # слота 1 нет
    assert resolve_slot_mappings(tools, [_slot(1, spool=False)]) is None  # слот пуст


def test_resolve_mappings_no_usage_returns_none():
    assert resolve_slot_mappings([{"tool_index": 0, "used_g": 0}], [_slot(0)]) is None


# --- сверка гейтов хаба с катушками (match_gate) ---
from app.services.moonraker import match_gate, parse_hub


def _gate(occupied=True, material="PLA+", color="#B81B0E"):
    return {"occupied": occupied, "material": material, "color_hex": color}


def test_match_gate_ok_close_color_and_material_subset():
    # хаб: PLA+ #B81B0E, катушка: PLA+/Pro #BB1E10 — совпадение
    assert match_gate(_gate(), "PLA+/Pro", "#BB1E10") == "match"


def test_match_gate_mismatch_color():
    assert match_gate(_gate(color="#FFFFFF"), "PLA+/Pro", "#000000") == "mismatch"


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
from app.services.moonraker import parse_dryer


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


def test_parse_dryer_none_without_hub():
    assert parse_dryer({"result": {"status": {}}}) is None
