"""Сверка расчёта с исходной таблицей Pricing Worksheet V2.

Числа в WORKSHEET_* взяты из самого xlsx (кэшированные значения формул), а не
пересчитаны нами: в этом и смысл — если формулу случайно упростят, тест поймает
расхождение с первоисточником. Сравнение через approx, потому что последние
разряды там — обычный шум float.
"""

import pytest

from app.services import cost_service


# Тарифы листа: доллары, ферма, 50 % загрузки.
WORKSHEET_RATES = {
    "material_efficiency": 1.1,      # C4
    "labor_per_hour": 20.0,          # C6
    "printer_price": 1000.0,         # C11
    "extra_upfront": 0.0,            # C12
    "maintenance_per_year": 75.0,    # C15
    "life_years": 3.0,               # C18
    "uptime_pct": 50.0,              # C19 (в листе долей 0.5)
    "power_w": 150.0,                # C22
    "electricity_per_kwh": 0.14,     # C23
    "buffer_factor": 1.3,            # C28
    "printer_per_hour": None,
}

WORKSHEET_INPUTS = {
    "part_name": "Example Part 1",
    "material": "PETG",
    "qty": 1,
    "filament_price_per_kg": 20.0,   # D10
    "filament_g": 100.0,             # D11
    "print_time_h": 3.5,             # D12
    "labor_min": 10.0,               # D13
    "hardware": [],
    "packaging": [],
    "margins": [50, 60, 70],
    "currency": "USD",
    "rates": WORKSHEET_RATES,
}


def test_machine_rate_matches_worksheet():
    rate = cost_service.machine_rate(WORKSHEET_RATES)
    assert rate["total_investment"] == pytest.approx(1000.0)          # C13
    assert rate["lifetime_cost"] == pytest.approx(1225.0)             # C16
    assert rate["uptime_hours_per_year"] == pytest.approx(4380.0)     # C20
    assert rate["capital_per_hour"] == pytest.approx(0.0932267884322679, rel=1e-12)   # C26
    assert rate["electric_per_hour"] == pytest.approx(0.021, rel=1e-12)               # C27
    assert rate["total_per_hour"] == pytest.approx(0.14849482496194824, rel=1e-12)    # C29


def test_reference_run_totals():
    out = cost_service.compute(WORKSHEET_INPUTS)
    assert out["materials_total"] == pytest.approx(2.2000000000000002, rel=1e-12)     # G26
    assert out["labor_total"] == pytest.approx(3.333333333333333, rel=1e-12)          # G28
    assert out["machine_total"] == pytest.approx(0.51973188736681886, rel=1e-12)      # G43
    assert out["packaging_total"] == pytest.approx(0.0)                               # G41
    assert out["landed_total"] == pytest.approx(6.0530652207001516, rel=1e-12)        # G45


def test_reference_prices():
    prices = [p["price"] for p in cost_service.compute(WORKSHEET_INPUTS)["prices"]]
    assert prices[0] == pytest.approx(12.106130441400303, rel=1e-12)   # G49
    assert prices[1] == pytest.approx(15.132663051750379, rel=1e-12)   # G51
    assert prices[2] == pytest.approx(20.176884069000501, rel=1e-12)   # G53


def test_hardware_and_packaging_rows():
    base = cost_service.compute(WORKSHEET_INPUTS)["landed_total"]
    out = cost_service.compute({
        **WORKSHEET_INPUTS,
        "hardware": [{"name": "Винт M3×12", "qty": 4, "unit_cost": 3.5}],
        "packaging": [
            {"name": "Коробка", "qty": 1, "unit_cost": 25.0},
            {"name": "Доставка", "qty": 1, "unit_cost": 350.0},
        ],
    })
    assert out["hardware_total"] == pytest.approx(14.0)
    assert out["materials_total"] == pytest.approx(16.2, rel=1e-12)
    assert out["packaging_total"] == pytest.approx(375.0)
    assert out["landed_total"] == pytest.approx(base + 389.0, rel=1e-12)


def test_blank_rows_ignored():
    """Пустые строки шаблона не должны ни считаться, ни ронять расчёт."""
    out = cost_service.compute({
        **WORKSHEET_INPUTS,
        "hardware": [
            {"name": "", "qty": 0, "unit_cost": 0},
            {"name": "(Insert name here)", "qty": None, "unit_cost": None},
            {"name": "x", "qty": "", "unit_cost": ""},
        ],
    })
    assert out["hardware_total"] == pytest.approx(0.0)
    assert out["landed_total"] == pytest.approx(6.0530652207001516, rel=1e-12)


def test_qty_multiplies_only_part_row():
    """Тираж умножает только печатную деталь — как в листе.

    Время печати и труд там названы «Total» и задаются на всю партию, поэтому
    множить их на тираж нельзя: это была бы уже другая таблица.
    """
    one = cost_service.compute(WORKSHEET_INPUTS)
    three = cost_service.compute({**WORKSHEET_INPUTS, "qty": 3})
    assert three["part_row_total"] == pytest.approx(3 * one["unit_material_cost"], rel=1e-12)
    assert three["labor_total"] == pytest.approx(one["labor_total"], rel=1e-12)
    assert three["machine_total"] == pytest.approx(one["machine_total"], rel=1e-12)


def test_resolve_rates_printer_overrides_defaults():
    rates = cost_service.resolve_rates(
        {"power_w": 120.0, "uptime_pct": None, "junk": 1, "labor_per_hour": 1.0},
    )
    assert rates["power_w"] == 120.0   # своё у принтера
    assert rates["uptime_pct"] == cost_service.DEFAULTS["uptime_pct"]  # пусто — по умолчанию
    # Труд — про работу, а не про машину: принтер его не переопределяет.
    assert rates["labor_per_hour"] == cost_service.DEFAULTS["labor_per_hour"]
    assert "junk" not in rates


def test_printer_rates_without_printer_are_defaults():
    """Расчёт без принтера должен давать осмысленную цифру, а не ноль."""
    assert cost_service.printer_rates(None) == cost_service.DEFAULTS


def test_validate_params_keeps_blank_as_none():
    out = cost_service.validate_params({"power_w": "", "uptime_pct": 45, "junk": 1})
    assert out == {"power_w": None, "uptime_pct": 45.0}


def test_explicit_printer_per_hour_wins():
    """Своя ставка ₽/ч отменяет вывод из амортизации, но не разбор."""
    out = cost_service.compute({
        **WORKSHEET_INPUTS,
        "rates": {**WORKSHEET_RATES, "printer_per_hour": 25.0, "printer_price": 999999.0},
    })
    assert out["machine_total"] == pytest.approx(3.5 * 25.0)
    assert out["machine_rate"]["explicit"] is True


def test_zero_uptime_does_not_crash():
    for broken in ({"uptime_pct": 0.0}, {"life_years": 0.0}):
        rate = cost_service.machine_rate({**WORKSHEET_RATES, **broken})
        assert rate["capital_per_hour"] == 0.0
        assert rate["electric_per_hour"] == pytest.approx(0.021, rel=1e-12)


def test_margin_100_has_no_price():
    prices = cost_service.compute({**WORKSHEET_INPUTS, "margins": [50, 100, 120]})["prices"]
    assert prices[0]["price"] is not None
    assert prices[1]["price"] is None
    assert prices[2]["price"] is None


def test_currency_is_a_label_not_a_conversion():
    """Смена валюты подписывает суммы, но не трогает числа.

    Курса в приложении нет, и это осознанно: иначе его пришлось бы откуда-то
    брать и хранить на момент расчёта. Тест закрепляет договорённость.
    """
    rub = cost_service.compute({**WORKSHEET_INPUTS, "currency": "RUB"})
    eur = cost_service.compute({**WORKSHEET_INPUTS, "currency": "EUR"})
    assert rub["landed_total"] == eur["landed_total"]
    assert (rub["currency"], eur["currency"]) == ("RUB", "EUR")


def test_currency_validated_against_list():
    from fastapi import HTTPException

    assert cost_service.validate_currency("usd") == "USD"
    assert cost_service.validate_currency(None) == cost_service.DEFAULT_CURRENCY
    with pytest.raises(HTTPException) as e:
        cost_service.validate_currency("XYZ")
    assert e.value.status_code == 422
    assert "XYZ" in e.value.detail


def test_ru_defaults_machine_rate():
    """Замок на поставляемые дефолты: менять их можно только осознанно."""
    rate = cost_service.machine_rate(cost_service.DEFAULTS)
    assert rate["lifetime_cost"] == pytest.approx(75000.0)
    assert rate["uptime_hours_per_year"] == pytest.approx(2628.0)
    assert rate["total_per_hour"] == pytest.approx(13.53681887366819, rel=1e-12)


def test_ru_defaults_full_run():
    out = cost_service.compute({
        "qty": 1,
        "filament_price_per_kg": 1500.0,
        "filament_g": 100.0,
        "print_time_h": 3.5,
        "labor_min": 10.0,
        "rates": cost_service.DEFAULTS,
    })
    assert out["materials_total"] == pytest.approx(165.0, rel=1e-12)
    assert out["labor_total"] == pytest.approx(83.33333333333333, rel=1e-12)
    assert out["machine_total"] == pytest.approx(47.378866057838664, rel=1e-12)
    assert out["landed_total"] == pytest.approx(295.71219939117196, rel=1e-12)
    assert out["currency"] == "RUB"  # валюта по умолчанию — рубли
