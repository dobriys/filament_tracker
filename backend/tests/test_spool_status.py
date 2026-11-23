"""Порог «катушка заканчивается» и статус катушки по остатку.

Порогов было три и они противоречили друг другу: статус ставился на 50 г,
уведомление уходило на 100 г, а подсветка считалась в процентах (15 %). Свели к
одному правилу, но одним числом в граммах дело не решается: дома встречаются и
пробники 250 г, и бухты 3 кг. Поэтому доля от ёмкости катушки, подрезанная с
двух сторон, — см. settings_service.low_threshold_for.
"""
from types import SimpleNamespace

import pytest

from app.services.settings_service import (
    SPOOL_LOW_MAX_DEFAULT,
    SPOOL_LOW_MIN_DEFAULT,
    SPOOL_LOW_PCT_DEFAULT,
    low_threshold_for,
)
from app.services.spool_service import recompute_status

DEFAULTS = {
    "pct": SPOOL_LOW_PCT_DEFAULT,
    "min_g": SPOOL_LOW_MIN_DEFAULT,
    "max_g": SPOOL_LOW_MAX_DEFAULT,
}


def _spool(grams, status="in_use"):
    return SimpleNamespace(current_weight_g=grams, status=status)


# --- порог от размера катушки -------------------------------------------


@pytest.mark.parametrize(
    "capacity, expected",
    [
        (250, 50),     # пробник: 10 % = 25 г, поднимает нижний зажим
        (500, 50),     # ровно 10 %, он же нижний зажим
        (750, 75),     # Fillamentum/colorFabb
        (1000, 100),   # стандарт настольной печати — прежний дефолт
        (2000, 200),   # ровно 10 %, он же верхний зажим
        (3000, 200),   # 10 % = 300 г, подрезает верхний зажим
        (5000, 200),   # бухта: 500 г было бы ещё половиной суток печати
    ],
)
def test_threshold_scales_with_spool_size(capacity, expected):
    assert low_threshold_for(capacity, DEFAULTS) == expected


def test_unknown_capacity_counts_as_one_kilogram():
    """Початая катушка без указанной ёмкости — стандартный килограмм."""
    assert low_threshold_for(None, DEFAULTS) == 100
    assert low_threshold_for(0, DEFAULTS) == 100


def test_zero_percent_makes_a_fixed_threshold():
    """Так выглядит унаследованный единый порог: доля 0, зажимы равны."""
    assert low_threshold_for(250, {"pct": 0, "min_g": 100, "max_g": 100}) == 100
    assert low_threshold_for(5000, {"pct": 0, "min_g": 100, "max_g": 100}) == 100


def test_swapped_clamps_do_not_collapse_threshold():
    """Зажимы, введённые наоборот, не должны обнулять порог."""
    assert low_threshold_for(1000, {"pct": 10, "min_g": 200, "max_g": 50}) == 100


# --- статус по остатку --------------------------------------------------


def test_status_follows_threshold():
    s = _spool(120)
    recompute_status(s, 100)
    assert s.status == "in_use"

    s = _spool(100)
    recompute_status(s, 100)
    assert s.status == "almost_empty"  # ровно порог — уже «заканчивается»

    s = _spool(0)
    recompute_status(s, 100)
    assert s.status == "empty"


def test_same_remainder_reads_differently_on_different_spools():
    """40 г на пробнике 250 г — уже мало; на килограммовой — тем более."""
    sample, standard = _spool(40), _spool(40)
    recompute_status(sample, low_threshold_for(250, DEFAULTS))
    recompute_status(standard, low_threshold_for(1000, DEFAULTS))
    assert sample.status == "almost_empty" and standard.status == "almost_empty"

    # А вот 120 г: на пробнике их просто не бывает, на 1 кг — ещё рабочая,
    # на 3 кг — уже сигнал.
    mid, big = _spool(120), _spool(120)
    recompute_status(mid, low_threshold_for(1000, DEFAULTS))
    recompute_status(big, low_threshold_for(3000, DEFAULTS))
    assert mid.status == "in_use"
    assert big.status == "almost_empty"


def test_status_returns_to_in_use_after_refill():
    """Порог работает в обе стороны: долили/перевзвесили — статус снимается."""
    s = _spool(900, status="almost_empty")
    recompute_status(s, 100)
    assert s.status == "in_use"


def test_new_spool_stays_new_until_used():
    s = _spool(1000, status="new")
    recompute_status(s, 100)
    assert s.status == "new"


def test_archived_spool_is_never_touched():
    s = _spool(0, status="archived")
    recompute_status(s, 100)
    assert s.status == "archived"


# --- статус сразу при создании ------------------------------------------


class _FakeDb:
    """Ровно то, что нужно create_spool: добавить, сбросить, сохранить."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass

    def commit(self):
        pass

    def refresh(self, obj):
        pass


@pytest.mark.parametrize(
    "left, expected",
    [
        (60, "almost_empty"),  # початая катушка с остатком ниже порога
        (0, "empty"),
        (1000, "new"),         # полная — остаётся «новой», пока не печатали
    ],
)
def test_created_spool_gets_status_from_its_remainder(monkeypatch, left, expected):
    """Раньше статус при создании всегда был «новая» и менялся только после
    первого события — катушка с 60 г висела «новой»."""
    from app.services import spool_service

    monkeypatch.setattr(spool_service, "low_threshold", lambda db, spool: 100)
    owner = SimpleNamespace(id=None)
    spool = spool_service.create_spool(
        _FakeDb(),
        owner=owner,
        data={"initial_filament_weight_g": 1000, "current_weight_g": left},
    )
    assert spool.status == expected


# --- «новая» до первого списания ----------------------------------------


def _new_spool(grams=1000):
    return SimpleNamespace(
        id=None, current_weight_g=grams, status="new", initial_filament_weight_g=1000
    )


@pytest.fixture
def fixed_threshold(monkeypatch):
    from app.services import spool_service

    monkeypatch.setattr(spool_service, "low_threshold", lambda db, spool: 100)
    return spool_service


def test_first_print_usage_makes_new_spool_in_use(fixed_threshold):
    spool = _new_spool()
    fixed_threshold.consume(_FakeDb(), spool, used_g=25, user=None, commit=False)
    assert spool.status == "in_use"


@pytest.mark.parametrize("call", ["adjust_down", "weigh_lighter"])
def test_any_decrease_counts_as_first_use(fixed_threshold, call):
    """Списать вручную или перевесить легче — тоже значит, что катушку начали."""
    spool = _new_spool()
    spool.empty_spool_weight_g = 200
    if call == "adjust_down":
        fixed_threshold.adjust(_FakeDb(), spool, delta_g=-10, new_weight_g=None, user=None)
    else:
        fixed_threshold.weigh(_FakeDb(), spool, total_weight_g=1150, user=None)
    assert spool.status == "in_use"


def test_increase_or_same_weight_keeps_new(fixed_threshold):
    """Уточнили вес вверх или перевесили без изменений — катушку ещё не трогали."""
    spool = _new_spool(950)
    fixed_threshold.adjust(_FakeDb(), spool, delta_g=None, new_weight_g=1000, user=None)
    assert spool.status == "new"
    spool.empty_spool_weight_g = 0
    fixed_threshold.weigh(_FakeDb(), spool, total_weight_g=1000, user=None)
    assert spool.status == "new"


def test_first_use_below_threshold_goes_straight_to_almost_empty(fixed_threshold):
    spool = _new_spool(120)
    fixed_threshold.consume(_FakeDb(), spool, used_g=30, user=None, commit=False)
    assert spool.status == "almost_empty"


def test_used_spool_never_returns_to_new(fixed_threshold):
    spool = _new_spool()
    fixed_threshold.consume(_FakeDb(), spool, used_g=25, user=None, commit=False)
    fixed_threshold.adjust(_FakeDb(), spool, delta_g=None, new_weight_g=1000, user=None)
    assert spool.status == "in_use"
