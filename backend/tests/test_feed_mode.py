"""Режим подачи: авто/мультиподача/прямая (чистые функции, без БД и сети)."""
from app.services.feed_mode import (
    MISSES_TO_DIRECT,
    effective_capabilities,
    next_misses,
    setting_of,
)
from app.services.moonraker import detect_capabilities, parse_hub, parse_hub_enabled

ACE = {"has_mmu": True, "mmu_slots": 4, "mmu_name": "ACE Pro", "has_dryer": True,
       "has_chamber": True}
GATES = [{"gate": i, "slot_index": i + 1} for i in range(4)]


def _caps(stored, *, gates=(), dryer=None, setting="auto", hub_missing=False):
    return effective_capabilities(
        stored, gates=list(gates), dryer=dryer, setting=setting, hub_missing=hub_missing
    )


# --- телеметрия ---------------------------------------------------------


def test_detect_capabilities_strips_only_when_online():
    """Пустой хаб при подтверждённой связи снимает возможности, иначе молчит."""
    assert detect_capabilities([], None) == {}
    assert detect_capabilities([], None, online=True) == {
        "has_mmu": False, "has_dryer": False
    }
    assert detect_capabilities(GATES, {"status": "stop"}, online=True) == {
        "has_mmu": True, "mmu_slots": 4, "has_dryer": True
    }


def test_disconnected_ace_still_reports_gates_but_is_disabled():
    """Снимок реального Kobra S1 с отсоединённым ACE: гейты есть, enabled=false."""
    payload = {"result": {"status": {"mmu": {
        "enabled": False, "num_gates": 4, "unit": -1,
        "gate_status": [0, 0, 0, 0],
        "gate_material": ["Unknown"] * 4,
        "gate_color": ["000000FF"] * 4,
    }}}}
    assert len(parse_hub(payload)) == 4  # телеметрия хаба никуда не делась
    assert parse_hub_enabled(payload) is False


def test_hub_enabled_flag_absent_for_plain_printer():
    assert parse_hub_enabled({"result": {"status": {}}}) is None
    assert parse_hub_enabled({"result": {"status": {"mmu": {"num_gates": 4}}}}) is None
    assert parse_hub_enabled({"result": {"status": {"mmu": {"enabled": True}}}}) is True


def test_disabled_hub_goes_direct_despite_live_gates():
    """Главный случай: ACE отсоединили — гейты в ответе есть, но верить им нельзя."""
    caps = _caps(ACE, gates=GATES, dryer={"status": "stop"}, hub_missing=True)
    assert caps["feed_mode"] == "direct"
    assert caps["has_mmu"] is False and caps["has_dryer"] is False and caps["mmu_off"] is True


# --- гистерезис ---------------------------------------------------------


def test_misses_need_several_polls_before_direct():
    misses = 0
    for _ in range(MISSES_TO_DIRECT - 1):
        misses = next_misses(misses, has_gates=False, online=True)
        assert misses < MISSES_TO_DIRECT
    assert next_misses(misses, has_gates=False, online=True) >= MISSES_TO_DIRECT


def test_misses_reset_when_hub_answers():
    assert next_misses(MISSES_TO_DIRECT, has_gates=True, online=True) == 0


def test_misses_frozen_while_offline():
    """Обрыв связи — не довод: пустые гейты там ничего не доказывают."""
    assert next_misses(1, has_gates=False, online=False) == 1
    assert next_misses(0, has_gates=False, online=False) == 0


# --- разрешение возможностей -------------------------------------------


def test_auto_keeps_mmu_while_hub_answers():
    caps = _caps(ACE, gates=GATES, dryer={"status": "stop"})
    assert caps["feed_mode"] == "mmu"
    assert caps["has_mmu"] and caps["mmu_slots"] == 4 and caps["has_dryer"]


def test_auto_switches_to_direct_when_hub_confirmed_gone():
    caps = _caps(ACE, hub_missing=True)
    assert caps["feed_mode"] == "direct"
    assert caps["has_mmu"] is False and caps["has_dryer"] is False
    assert "mmu_slots" not in caps
    # Название системы и метка «снята» остаются — по ним UI пишет, что отключено.
    assert caps["mmu_name"] == "ACE Pro" and caps["mmu_off"] is True
    # Возможности самого принтера прямая подача не затрагивает.
    assert caps["has_chamber"] is True


def test_auto_holds_mmu_until_confirmed():
    """Одного пустого ответа мало — пресетная мультиподача остаётся."""
    assert _caps(ACE, hub_missing=False)["feed_mode"] == "mmu"


def test_manual_mmu_ignores_silent_hub():
    caps = _caps(ACE, setting="mmu", hub_missing=True)
    assert caps["feed_mode"] == "mmu" and caps["has_mmu"]


def test_manual_direct_ignores_live_hub():
    caps = _caps(ACE, gates=GATES, dryer={"status": "drying"}, setting="direct")
    assert caps["feed_mode"] == "direct"
    assert caps["has_mmu"] is False and caps["has_dryer"] is False


def test_plain_printer_is_direct_without_mmu_off_marker():
    """У принтера без мультиподачи прямая подача — норма, а не «отключено»."""
    caps = _caps({"has_chamber": True}, hub_missing=True)
    assert caps["feed_mode"] == "direct" and caps["feed_mode_setting"] == "auto"
    assert "mmu_off" not in caps


def test_setting_of_defaults_to_auto():
    assert setting_of(None) == "auto"
    assert setting_of({"feed_mode": "bogus"}) == "auto"
    assert setting_of({"feed_mode": "direct"}) == "direct"
