"""Себестоимость и цена изделия: материал, труд, машиночас, упаковка.

Порт таблицы Print Farm Academy Pricing Worksheet V2 на рубли. Ссылки на ячейки
исходного листа оставлены в комментариях — по ним видно, что формула перенесена
без вольностей, и есть с чем сверяться, если таблицу обновят.

Считает то, чего в приложении не было: цену катушки приложение и так знает
(spool_service.price_per_gram → print_job_service.jobs_cost), а вот
электричество, амортизацию принтера, труд и наценку — нет.

Общих настроек у расчёта нет намеренно: тарифы железа живут у своего принтера
(Printer.cost_params), а ставка труда, расход филамента, наценки и валюта — в
самом расчёте. Отдельный глобальный экран только сбивал с толку: было неясно,
чьи цифры сейчас применяются.

Весь счёт — чистые функции над обычными словарями: так их можно проверить
тестами без базы (весь backend/tests/ так и устроен), а фронт держит зеркало
этих же формул в frontend/src/cost.js, чтобы пересчитывать при наборе.
"""

# Часов в году — база для «наработки за год» (C20 листа).
HOURS_PER_YEAR = 8760.0

# Значения по умолчанию: бытовая печать в России, а не ферма в США.
#
# Это одновременно и набор ключей: resolve_rates пропускает всё, чего здесь нет,
# так что случайный ключ из JSONB принтера в расчёт не попадёт.
DEFAULTS: dict = {
    # Материал и труд — про филамент и людей, у принтера не переопределяются.
    "filament_price_per_kg": 1500.0,   # ходовая катушка PLA/PETG 1 кг: 1200–1900 ₽
    "material_efficiency": 1.1,        # +10 % на юбку, продувку и брак (C4)
    "labor_per_hour": 500.0,           # ставка частного мастера за постобработку
    # Железо — всё это может быть своим у каждого принтера (Printer.cost_params).
    "printer_price": 60000.0,          # средний настольный FDM в РФ: 45–75 тыс.
    "extra_upfront": 0.0,              # корпус, сушилка, апгрейды — не у всех (C12)
    "maintenance_per_year": 5000.0,    # сопла, ремень, PTFE, стол за год
    "life_years": 3.0,                 # горизонт до морального устаревания
    "uptime_pct": 30.0,                # 8760 × 0.3 ≈ 2600 ч/год — дома это уже много
    "power_w": 150.0,                  # средняя за печать: пик 350 Вт, дальше ~100 Вт
    "electricity_per_kwh": 6.0,        # бытовой однотарифный: Москва ~6.5–7, регионы 4–6
    "buffer_factor": 1.3,              # запас на брак и перепечатки (C28)
    # Готовая ставка ₽/ч: задана — вывод из амортизации пропускается.
    "printer_per_hour": None,
}

# Ключи, которые принтер вправе переопределить: всё про железо, ничего про
# филамент и людей — те одни на всю мастерскую.
PRINTER_KEYS = (
    "printer_price",
    "extra_upfront",
    "maintenance_per_year",
    "life_years",
    "uptime_pct",
    "power_w",
    "electricity_per_kwh",
    "buffer_factor",
    "printer_per_hour",
)

DEFAULT_MARGINS = [50.0, 60.0, 70.0]
DEFAULT_CURRENCY = "RUB"

# Валюты, которые можно выбрать. Список тот же, что на фронте (format.js) и в
# подписях уведомлений (printer_watch._CURRENCY_SYMBOL) — иначе сумма в расчёте
# и та же сумма в Telegram подписывались бы по-разному.
#
# Пересчёта между валютами нет и не планируется: курс пришлось бы откуда-то
# брать и хранить на момент расчёта. Валюта здесь — подпись к числам, которые
# ввёл пользователь, поэтому менять её осмысленно только вместе с тарифами.
CURRENCIES = ("RUB", "USD", "EUR", "GBP", "CNY", "UAH", "KZT", "BYN")


def _num(value, default: float = 0.0) -> float:
    """Число из формы: пусто, None и мусор — это ноль, а не падение."""
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# --- чистый счёт ------------------------------------------------------------

def machine_rate(rates: dict) -> dict:
    """Во сколько обходится час работы принтера. Чистая функция.

    Амортизация вложений плюс электричество, всё это с запасом на непредвиденное
    (ячейки C13/C16/C20/C26/C27/C29 листа «Adv. Inputs»).

    Загрузка у нас в процентах (30), а не долей как в листе (0.5): в поле ввода
    процент нагляднее, а перепутать 0.3 и 30 — легко.
    """
    explicit = rates.get("printer_per_hour")
    life_years = _num(rates.get("life_years"))
    uptime_pct = _num(rates.get("uptime_pct"))
    buffer_factor = _num(rates.get("buffer_factor"), 1.0)

    total_investment = _num(rates.get("printer_price")) + _num(rates.get("extra_upfront"))
    lifetime_cost = total_investment + _num(rates.get("maintenance_per_year")) * life_years
    uptime_hours_per_year = HOURS_PER_YEAR * uptime_pct / 100

    lifetime_hours = uptime_hours_per_year * life_years
    # Простаивающий принтер не делится на ноль: без наработки амортизацию
    # разнести не на что, поэтому в час она равна нулю.
    capital_per_hour = lifetime_cost / lifetime_hours if lifetime_hours else 0.0
    electric_per_hour = _num(rates.get("power_w")) / 1000 * _num(rates.get("electricity_per_kwh"))

    total_per_hour = (capital_per_hour + electric_per_hour) * buffer_factor
    if explicit is not None and explicit != "":
        # Свою ставку пользователь уже посчитал сам — вывод не навязываем,
        # но разбор ниже показываем: видно, из чего сложилась бы наша.
        total_per_hour = _num(explicit)

    return {
        "total_investment": total_investment,
        "lifetime_cost": lifetime_cost,
        "uptime_hours_per_year": uptime_hours_per_year,
        "capital_per_hour": capital_per_hour,
        "electric_per_hour": electric_per_hour,
        "total_per_hour": total_per_hour,
        "explicit": explicit is not None and explicit != "",
    }


def _rows_total(rows) -> float:
    """Сумма списка строк «кол-во × цена» (G18:G24, G32:G39).

    Пустые строки пропускаем: в форме они остаются от шаблона, и считать их
    нулями было бы то же самое, но ронять расчёт на None они не должны.
    """
    total = 0.0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        total += _num(row.get("qty")) * _num(row.get("unit_cost"))
    return total


def compute(inputs: dict) -> dict:
    """Весь лист разом: от граммов филамента до цены по наценке.

    Округлений здесь нет намеренно — они только при выводе. Иначе копейки
    накапливаются от строки к строке, и итог расходится с таблицей.
    """
    rates = {**DEFAULTS, **(inputs.get("rates") or {})}
    rate = machine_rate(rates)

    qty = _num(inputs.get("qty"), 1.0)
    grams = _num(inputs.get("filament_g"))
    price_per_kg = _num(inputs.get("filament_price_per_kg"))
    efficiency = _num(rates.get("material_efficiency"), 1.0)

    # F17: цена филамента на одно изделие, с поправкой на перерасход.
    unit_material_cost = grams / 1000 * price_per_kg * efficiency
    part_row_total = unit_material_cost * qty          # G17
    hardware_total = _rows_total(inputs.get("hardware"))
    materials_total = part_row_total + hardware_total  # G26

    # G28 и G43: в листе это поля «Total Labor Required» и «Total Printing Time»,
    # то есть на всю партию сразу, — тираж их не умножает. Квирк сохранён
    # осознанно, в интерфейсе об этом сказано подписью под полем «Штук в партии».
    labor_total = _num(inputs.get("labor_min")) / 60 * _num(rates.get("labor_per_hour"))
    machine_total = _num(inputs.get("print_time_h")) * rate["total_per_hour"]

    packaging_total = _rows_total(inputs.get("packaging"))  # G41
    landed_total = materials_total + labor_total + machine_total + packaging_total  # G45

    margins = inputs.get("margins")
    if not margins:
        margins = DEFAULT_MARGINS
    prices = []
    for margin in margins:
        m = _num(margin)
        # Наценка 100 % и выше означала бы деление на ноль или отрицательную цену:
        # такой цены не существует, и показать нужно прочерк, а не минус.
        price = landed_total / (1 - m / 100) if m < 100 else None
        prices.append({"margin": m, "price": price})

    return {
        "unit_material_cost": unit_material_cost,
        "part_row_total": part_row_total,
        "hardware_total": hardware_total,
        "materials_total": materials_total,
        "labor_total": labor_total,
        "machine_total": machine_total,
        "packaging_total": packaging_total,
        "landed_total": landed_total,
        "machine_rate": rate,
        "prices": prices,
        "currency": inputs.get("currency") or DEFAULT_CURRENCY,
    }


def resolve_rates(printer: dict | None) -> dict:
    """Тарифы железа: параметры принтера поверх значений по умолчанию, поле за полем.

    Пустое поле у принтера — значение по умолчанию. Ключи в обоих словарях
    называются одинаково специально: слияние не нуждается в таблице соответствий.

    Ставка труда и коэффициент расхода сюда не попадают: они про работу, а не
    про машину, и задаются в самом расчёте.
    """
    out = dict(DEFAULTS)
    for key, value in (printer or {}).items():
        if key in PRINTER_KEYS and value is not None:
            out[key] = value
    return out


# --- настройки --------------------------------------------------------------

# Человеческие имена полей для сообщений об ошибке — 422 читает пользователь,
# а не разработчик.
FIELD_NAMES = {
    "filament_price_per_kg": "Цена филамента, ₽/кг",
    "labor_per_hour": "Ставка труда, ₽/ч",
    "printer_price": "Цена принтера, ₽",
    "extra_upfront": "Дополнительные вложения, ₽",
    "maintenance_per_year": "Обслуживание в год, ₽",
    "power_w": "Мощность принтера, Вт",
    "electricity_per_kwh": "Тариф на электричество, ₽/кВт·ч",
    "printer_per_hour": "Своя ставка принтера, ₽/ч",
}


def _positive(value, name: str, *, minimum: float = 0.0, maximum: float | None = None):
    from fastapi import HTTPException

    try:
        num = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{name}: ожидается число")
    if num < minimum or (maximum is not None and num > maximum):
        limit = f"от {minimum:g} до {maximum:g}" if maximum is not None else f"не меньше {minimum:g}"
        raise HTTPException(status_code=422, detail=f"{name}: {limit}")
    return num


def validate_currency(value) -> str:
    """Код валюты из списка, приведённый к верхнему регистру."""
    from fastapi import HTTPException

    code = str(value or DEFAULT_CURRENCY).strip().upper()
    if code not in CURRENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"Неизвестная валюта: {value}. Доступны: {', '.join(CURRENCIES)}",
        )
    return code


def validate_params(params: dict) -> dict:
    """Проверить и привести к числам тарифы принтера.

    Пустое поле осмысленно и остаётся None: это «взять значение по умолчанию»,
    а не ноль. Ключи не из PRINTER_KEYS отбрасываем — в JSONB иначе накопится
    что угодно.
    """
    out: dict = {}
    for key, value in (params or {}).items():
        if key not in PRINTER_KEYS:
            continue
        if value is None or value == "":
            out[key] = None
            continue
        if key == "uptime_pct":
            out[key] = _positive(value, "Загрузка принтера, %", minimum=0, maximum=100)
        elif key == "life_years":
            out[key] = _positive(value, "Срок службы, лет", minimum=0, maximum=50)
        elif key == "buffer_factor":
            out[key] = _positive(value, "Буфер", minimum=1, maximum=10)
        else:
            out[key] = _positive(value, FIELD_NAMES.get(key, key))
    return out


def printer_rates(printer=None) -> dict:
    """Тарифы железа для этого принтера: его параметры поверх значений по умолчанию.

    Принтер не выбран — остаются значения по умолчанию: расчёт должен показывать
    осмысленную цифру сразу, а не ноль до настройки принтера.
    """
    return resolve_rates(getattr(printer, "cost_params", None) if printer is not None else None)
