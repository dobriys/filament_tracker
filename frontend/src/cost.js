// Себестоимость и цена изделия — зеркало backend/app/services/cost_service.py.
//
// Копия нужна затем, чтобы итог пересчитывался прямо при наборе, без запроса на
// каждую цифру. Источник правды всё равно сервер: он считает при каждой записи,
// и сохранённые totals приходят от него. Формулы держим синхронными вручную —
// та же договорённость, что у lowThresholdG в demo.js.
//
// Общих настроек у расчёта нет: тарифы железа живут у принтера, ставка труда и
// расход филамента — в самом расчёте. DEFAULTS ниже — не «настройка», а
// значения по умолчанию для принтера, у которого своих цифр ещё нет.
//
// Ссылки на ячейки в комментариях — из исходной таблицы Pricing Worksheet V2.

export const HOURS_PER_YEAR = 8760;

// Значения по умолчанию. Должны совпадать с cost_service.DEFAULTS.
export const DEFAULTS = {
  filament_price_per_kg: 1500,
  material_efficiency: 1.1,
  labor_per_hour: 500,
  printer_price: 60000,
  extra_upfront: 0,
  maintenance_per_year: 5000,
  life_years: 3,
  uptime_pct: 30,
  power_w: 150,
  electricity_per_kwh: 6,
  buffer_factor: 1.3,
  printer_per_hour: null,
};

// Что можно задать отдельно у принтера (cost_service.PRINTER_KEYS): всё про
// железо. Расход филамента и ставка труда — одни на всю мастерскую.
export const PRINTER_KEYS = [
  "printer_price",
  "extra_upfront",
  "maintenance_per_year",
  "life_years",
  "uptime_pct",
  "power_w",
  "electricity_per_kwh",
  "buffer_factor",
  "printer_per_hour",
];

export const DEFAULT_MARGINS = [50, 60, 70];

// Число из поля ввода: пусто и мусор — ноль, а не NaN на весь расчёт.
function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Во сколько обходится час работы принтера (C13/C16/C20/C26/C27/C29).
export function machineRate(rates = {}) {
  const explicit = rates.printer_per_hour;
  const hasExplicit = explicit !== null && explicit !== undefined && explicit !== "";
  const lifeYears = num(rates.life_years);
  const uptimePct = num(rates.uptime_pct);

  const totalInvestment = num(rates.printer_price) + num(rates.extra_upfront);
  const lifetimeCost = totalInvestment + num(rates.maintenance_per_year) * lifeYears;
  const uptimeHoursPerYear = (HOURS_PER_YEAR * uptimePct) / 100;

  const lifetimeHours = uptimeHoursPerYear * lifeYears;
  // Простаивающий принтер не делится на ноль: разносить амортизацию не на что.
  const capitalPerHour = lifetimeHours ? lifetimeCost / lifetimeHours : 0;
  const electricPerHour = (num(rates.power_w) / 1000) * num(rates.electricity_per_kwh);

  const derived = (capitalPerHour + electricPerHour) * num(rates.buffer_factor, 1);
  return {
    total_investment: totalInvestment,
    lifetime_cost: lifetimeCost,
    uptime_hours_per_year: uptimeHoursPerYear,
    capital_per_hour: capitalPerHour,
    electric_per_hour: electricPerHour,
    total_per_hour: hasExplicit ? num(explicit) : derived,
    explicit: hasExplicit,
  };
}

// Тарифы железа: параметры принтера поверх значений по умолчанию, поле за полем.
// Ставка труда и коэффициент расхода сюда не попадают — они про работу,
// а не про машину, и задаются в самом расчёте.
export function resolveRates(printer) {
  const out = { ...DEFAULTS };
  Object.entries(printer || {}).forEach(([key, value]) => {
    if (PRINTER_KEYS.includes(key) && value !== null && value !== undefined) out[key] = value;
  });
  return out;
}

// Сумма списка строк «кол-во × цена» (G18:G24, G32:G39). Пустые строки шаблона
// молча пропускаем — они остаются в форме и считаться не должны.
function rowsTotal(rows) {
  return (rows || []).reduce(
    (sum, row) => sum + (row ? num(row.qty) * num(row.unit_cost) : 0),
    0,
  );
}

// Весь лист разом. Округлений нет намеренно — только при выводе, иначе копейки
// накапливаются от строки к строке и итог расходится с таблицей.
export function compute(inputs = {}) {
  const rates = { ...DEFAULTS, ...(inputs.rates || {}) };
  const rate = machineRate(rates);

  const qty = num(inputs.qty, 1);
  const unitMaterialCost =
    (num(inputs.filament_g) / 1000) *
    num(inputs.filament_price_per_kg) *
    num(rates.material_efficiency, 1); // F17
  const partRowTotal = unitMaterialCost * qty; // G17
  const hardwareTotal = rowsTotal(inputs.hardware);
  const materialsTotal = partRowTotal + hardwareTotal; // G26

  // В листе это «Total Labor Required» и «Total Printing Time» — на всю партию
  // сразу, поэтому тираж их не умножает. Квирк сохранён осознанно.
  const laborTotal = (num(inputs.labor_min) / 60) * num(rates.labor_per_hour); // G28
  const machineTotal = num(inputs.print_time_h) * rate.total_per_hour; // G43

  const packagingTotal = rowsTotal(inputs.packaging); // G41
  const landedTotal = materialsTotal + laborTotal + machineTotal + packagingTotal; // G45

  const margins = inputs.margins?.length ? inputs.margins : DEFAULT_MARGINS;
  const prices = margins.map((margin) => {
    const m = num(margin);
    // Наценка 100 % и выше — это деление на ноль или отрицательная цена.
    return { margin: m, price: m < 100 ? landedTotal / (1 - m / 100) : null };
  });

  return {
    unit_material_cost: unitMaterialCost,
    part_row_total: partRowTotal,
    hardware_total: hardwareTotal,
    materials_total: materialsTotal,
    labor_total: laborTotal,
    machine_total: machineTotal,
    packaging_total: packagingTotal,
    landed_total: landedTotal,
    machine_rate: rate,
    prices,
    currency: inputs.currency || "RUB",
  };
}
