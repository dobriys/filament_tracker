// Демо-режим: полностью клиентский мок API. Когда включён (VITE_DEMO=1 при
// сборке или window.__FT_CONFIG__.demo), client.js направляет все вызовы сюда
// вместо fetch — бэкенд не нужен. Данные живут в памяти и localStorage, правки
// сохраняются между переходами; «Сбросить демо» очищает хранилище.
//
// Цель — дать «пощупать» приложение: инвентарь катушек, принтер с живой
// печатью и сушкой, списание печатей, этикетки, дашборд. Точность второстепенна
// по сравнению с бэкендом, но формы ответов повторяют реальные роутеры.

export const DEMO =
  (typeof window !== "undefined" && !!window.__FT_CONFIG__?.demo) ||
  import.meta.env.VITE_DEMO === "1" ||
  import.meta.env.VITE_DEMO === true;

const STORE_KEY = "ft_demo_db_v2";
const TOKEN_KEY = "ft_token";

// Плотности (г/см³) для оценки веса по длине — совпадают с фронтом/бэком.
const DENSITY = {
  PLA: 1.24, "PLA+": 1.24, PETG: 1.27, PET: 1.27, ABS: 1.04, ASA: 1.07,
  TPU: 1.21, TPE: 1.21, PC: 1.2, NYLON: 1.14, PA: 1.14, HIPS: 1.04, PVA: 1.23, PP: 0.9,
};
// Порог «катушка заканчивается» — доля от ёмкости катушки с зажимами, как на
// бэке (settings_service.low_threshold_for). Одним числом в граммах не обойтись:
// 100 г на пробнике 250 г — это 40 %, а на бухте 3 кг — 3 %.
const LOW_DEFAULTS = { pct: 10, min_g: 50, max_g: 200 };
const DEFAULT_CAPACITY_G = 1000;
function lowThresholdG(capacity) {
  const c = Number(capacity) || DEFAULT_CAPACITY_G;
  const cfg = db.settings || {};
  const pct = Number(cfg.spool_low_pct ?? LOW_DEFAULTS.pct);
  let lo = Number(cfg.spool_low_min_g ?? LOW_DEFAULTS.min_g);
  let hi = Number(cfg.spool_low_max_g ?? LOW_DEFAULTS.max_g);
  if (hi < lo) [lo, hi] = [hi, lo];
  return Math.min(Math.max((c * pct) / 100, lo), hi);
}
const HYGROSCOPIC_DAYS = [
  ["PVA", 5], ["PA", 7], ["NYLON", 7], ["PC", 14], ["TPU", 14], ["TPE", 14],
  ["PETG", 30], ["PET", 30], ["ABS", 45], ["ASA", 45], ["HIPS", 45],
];

function dryingThresholdDays(material) {
  const m = (material || "").toUpperCase();
  for (const [tok, days] of HYGROSCOPIC_DAYS) {
    if (m.startsWith(tok) || (tok === "NYLON" && m.includes("NYLON"))) return days;
  }
  return null;
}
function densityFor(material) {
  const m = (material || "").toUpperCase().replace(/\s/g, "");
  return DENSITY[m] || DENSITY[m.replace(/\+$/, "")] || 1.24;
}
function gramsFromMm(mm, diameter, material) {
  const d = Number(diameter) || 1.75;
  return (Math.PI * (d / 2) ** 2 * Number(mm)) / 1000 * densityFor(material);
}

// Расширенные характеристики филамента по материалу (для блока «Характеристики
// филамента» на карточке). Ключи — из specFields.js (SPEC_GROUPS).
const MATERIAL_SPECS = {
  PLA: {
    material_type: "Basic", softening_temp: 60, shrinkage: 0.3,
    nozzle_min: 190, nozzle_max: 220, bed_min: 45, bed_max: 60,
    fan_min: 60, fan_max: 100, bridge_fan: 100, fan_disable_layers: "0-1",
    fl_wall_speed: 50, fl_infill_speed: 60, outer_wall_speed: 200, top_surface_speed: 150,
    ironing_flow: 10, ironing_speed: 30, max_volumetric_speed: 21, flow_ratio: 0.98,
    drying_temp: 45, dry_time_hours: 6, td: 4.2,
    ams_compatibility: ["AMS (A)", "AMS 2 Pro (A2)", "AMS Lite (L)"],
    build_plates: ["Textured PEI", "Smooth PEI", "Cool Plate"],
  },
  PETG: {
    material_type: "Basic", softening_temp: 80, shrinkage: 0.4,
    nozzle_min: 230, nozzle_max: 250, bed_min: 70, bed_max: 80,
    fan_min: 30, fan_max: 50, bridge_fan: 60, fan_disable_layers: "0-2",
    fl_wall_speed: 40, fl_infill_speed: 50, outer_wall_speed: 160, top_surface_speed: 120,
    max_volumetric_speed: 12, flow_ratio: 0.95, drying_temp: 65, dry_time_hours: 6, td: 3.6,
    ams_compatibility: ["AMS (A)", "AMS 2 Pro (A2)"],
    build_plates: ["Textured PEI", "Engineering Plate"],
  },
  ASA: {
    material_type: "Basic", softening_temp: 100, chamber_temp: 40, shrinkage: 0.6,
    nozzle_min: 240, nozzle_max: 260, bed_min: 90, bed_max: 100,
    fan_min: 0, fan_max: 20, bridge_fan: 30,
    fl_wall_speed: 40, fl_infill_speed: 50, outer_wall_speed: 150, top_surface_speed: 110,
    max_volumetric_speed: 10, flow_ratio: 0.96, drying_temp: 70, dry_time_hours: 4, td: 3.1,
    ams_compatibility: ["AMS 2 Pro (A2)", "AMS HT (HT)"],
    build_plates: ["Textured PEI", "Engineering Plate", "Garolite"],
  },
  ABS: {
    material_type: "Basic", softening_temp: 105, chamber_temp: 45, shrinkage: 0.8,
    nozzle_min: 240, nozzle_max: 260, bed_min: 95, bed_max: 110,
    fan_min: 0, fan_max: 0, bridge_fan: 20,
    fl_wall_speed: 40, fl_infill_speed: 50, outer_wall_speed: 150, top_surface_speed: 110,
    max_volumetric_speed: 15, flow_ratio: 0.96, drying_temp: 65, dry_time_hours: 4, td: 3.0,
    ams_compatibility: ["AMS 2 Pro (A2)", "AMS HT (HT)"],
    build_plates: ["Textured PEI", "Garolite"],
  },
  TPU: {
    material_type: "95A", softening_temp: 80, shrinkage: 0.8,
    nozzle_min: 220, nozzle_max: 235, bed_min: 40, bed_max: 50,
    fan_min: 40, fan_max: 60, bridge_fan: 60,
    fl_wall_speed: 20, fl_infill_speed: 25, outer_wall_speed: 40, top_surface_speed: 35,
    max_volumetric_speed: 5, flow_ratio: 1.0, drying_temp: 50, dry_time_hours: 8, td: 2.4,
    ams_compatibility: ["AMS Lite (L)"],
    build_plates: ["Textured PEI", "Smooth PEI"],
  },
};
// Материалы, склонные к «шелковистой» вариации (замедляем поток).
function specsForSpool(material, extra = {}) {
  const key = (material || "").toUpperCase().replace(/\s/g, "").replace(/\+$/, "");
  const base = MATERIAL_SPECS[key] || MATERIAL_SPECS.PLA;
  return { density: densityFor(material), ...base, ...extra };
}

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(16).slice(2) + Date.now().toString(16));
const nowIso = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const minsAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

// ---------------------------------------------------------------------------
// Сид-данные
// ---------------------------------------------------------------------------
const USER = {
  id: "demo-user-0001",
  email: "demo@filamenttracker.su",
  username: "demo",
  role: "admin",
  is_active: true,
  theme: null,
  created_at: daysAgo(210),
};

function seed() {
  const locOffice = { id: "loc-office", owner_user_id: USER.id, name: "Кабинет", parent_id: null, description: "", created_at: daysAgo(205) };
  const locRack = { id: "loc-rack", owner_user_id: USER.id, name: "Стеллаж", parent_id: locOffice.id, description: "", created_at: daysAgo(203) };
  const locHome = { id: "loc-shelf", owner_user_id: USER.id, name: "Полка у стола", parent_id: locRack.id, description: "Основной стеллаж", created_at: daysAgo(200) };
  const locBox = { id: "loc-drybox", owner_user_id: USER.id, name: "Сухобокс", parent_id: locOffice.id, description: "Гермобокс с силикагелем", created_at: daysAgo(180) };
  const locStock = { id: "loc-stock", owner_user_id: USER.id, name: "Запас (кладовка)", parent_id: null, description: "Нераспечатанные", created_at: daysAgo(150) };
  const locations = [locOffice, locRack, locHome, locBox, locStock];

  const mkProfile = (o) => ({
    id: o.id, owner_user_id: USER.id, brand: o.brand, name: o.name, material: o.material,
    color_name: o.color_name || null, color_hex: o.color_hex || null, diameter_mm: 1.75,
    density_g_cm3: densityFor(o.material), nozzle_temp_min: o.nmin, nozzle_temp_max: o.nmax,
    bed_temp_min: o.bmin, bed_temp_max: o.bmax, flow_ratio: o.flow || null, pressure_advance: o.pa || null,
    fan_percent: o.fan ?? 100, print_speed_mm_s: o.speed || 200, max_volumetric_speed: o.mvs || null,
    notes: o.notes || null, source_name: null, source_url: null, is_public: false, specs: null,
    created_at: daysAgo(o.age || 120), updated_at: daysAgo(o.age || 120),
  });
  const profiles = [
    mkProfile({ id: "prof-bambu-pla-black", brand: "Bambu Lab", name: "PLA Basic", material: "PLA", color_name: "Чёрный", color_hex: "#1a1a1a", nmin: 190, nmax: 220, bmin: 45, bmax: 60, flow: 0.98, pa: 0.02, mvs: 21, speed: 250 }),
    mkProfile({ id: "prof-bambu-pla-white", brand: "Bambu Lab", name: "PLA Basic", material: "PLA", color_name: "Белый", color_hex: "#f4f4f4", nmin: 190, nmax: 220, bmin: 45, bmax: 60, flow: 0.98, pa: 0.02, mvs: 21, speed: 250 }),
    mkProfile({ id: "prof-esun-petg-blue", brand: "eSun", name: "PETG", material: "PETG", color_name: "Синий", color_hex: "#1d5fd6", nmin: 230, nmax: 250, bmin: 70, bmax: 80, flow: 0.95, pa: 0.04, mvs: 12, speed: 180 }),
    mkProfile({ id: "prof-poly-asa-grey", brand: "Polymaker", name: "ASA", material: "ASA", color_name: "Серый", color_hex: "#7a7d82", nmin: 240, nmax: 260, bmin: 90, bmax: 100, flow: 0.96, pa: 0.05, fan: 20, mvs: 10, speed: 150 }),
    mkProfile({ id: "prof-sunlu-tpu", brand: "SUNLU", name: "TPU 95A", material: "TPU", color_name: "Красный", color_hex: "#d6263a", nmin: 220, nmax: 235, bmin: 40, bmax: 50, fan: 60, mvs: 5, speed: 40 }),
  ];

  // Катушки. weight — начальный нетто; current — текущий остаток.
  const mkSpool = (o) => {
    const empty = o.empty ?? 220;
    const initial = o.initial ?? 1000;
    const current = o.current ?? initial;
    const status = o.status || (current <= 0 ? "empty" : current <= 100 ? "almost_empty" : "in_use");
    return {
      id: o.id, owner_user_id: USER.id, filament_profile_id: o.profile || null, location_id: o.location || null,
      label: o.label, sku: o.sku || null, manufacturer: o.brand || null, barcode: null, photo: null,
      material: o.material, color_name: o.color_name || null, color_hex: o.color_hex || null,
      diameter_mm: 1.75, hotend_temp: o.nozzle || null, bed_temp: o.bed || null, fan_speed: o.fan ?? null,
      flow_rate: o.flow ?? null, specs: o.specs || specsForSpool(o.material, o.specExtra),
      initial_filament_weight_g: initial, empty_spool_weight_g: empty, current_weight_g: current,
      purchase_date: (o.purchased || daysAgo(90)).slice(0, 10), opened_date: o.opened ? o.opened.slice(0, 10) : null,
      price: o.price ?? null, currency: "RUB", notes: o.notes || null, status,
      qr_token: o.id.replace(/[^a-z0-9]/gi, "").slice(0, 12).padEnd(12, "0"),
      created_at: o.created || daysAgo(90), updated_at: nowIso(),
    };
  };
  const spools = [
    mkSpool({ id: "sp-pla-black", label: "PLA Чёрный", sku: "BL-PLA-BK", brand: "Bambu Lab", material: "PLA", color_name: "Чёрный", color_hex: "#1a1a1a", profile: "prof-bambu-pla-black", location: "loc-shelf", initial: 1000, current: 640, nozzle: 210, bed: 55, price: 1490, opened: daysAgo(40), created: daysAgo(85), specExtra: { gtin: "6975337000201", product_url: "https://bambulab.com/filament/pla-basic", datasheet_url: "https://bambulab.com/filament/pla-basic#tds" } }),
    mkSpool({ id: "sp-pla-white", label: "PLA Белый", sku: "BL-PLA-WT", brand: "Bambu Lab", material: "PLA", color_name: "Белый", color_hex: "#f4f4f4", profile: "prof-bambu-pla-white", location: "loc-shelf", initial: 1000, current: 815, nozzle: 210, bed: 55, price: 1490, opened: daysAgo(20), created: daysAgo(60) }),
    mkSpool({ id: "sp-petg-blue", label: "PETG Синий", sku: "ES-PETG-BL", brand: "eSun", material: "PETG", color_name: "Синий", color_hex: "#1d5fd6", profile: "prof-esun-petg-blue", location: "loc-shelf", initial: 1000, current: 470, nozzle: 240, bed: 75, price: 1290, opened: daysAgo(70), created: daysAgo(100), specExtra: { gtin: "6926492200085", product_url: "https://esun3d.com/petg-product" } }),
    mkSpool({ id: "sp-asa-grey", label: "ASA Серый", sku: "PM-ASA-GY", brand: "Polymaker", material: "ASA", color_name: "Серый", color_hex: "#7a7d82", profile: "prof-poly-asa-grey", location: "loc-drybox", initial: 1000, current: 910, nozzle: 250, bed: 95, price: 2190, opened: daysAgo(10), created: daysAgo(50) }),
    mkSpool({ id: "sp-tpu-red", label: "TPU Красный", sku: "SL-TPU-RD", brand: "SUNLU", material: "TPU", color_name: "Красный", color_hex: "#d6263a", profile: "prof-sunlu-tpu", location: "loc-drybox", initial: 1000, current: 780, nozzle: 228, bed: 45, fan: 60, price: 1690, opened: daysAgo(30), created: daysAgo(45) }),
    mkSpool({ id: "sp-pla-orange", label: "PLA Оранжевый", sku: "SL-PLA-OR", brand: "SUNLU", material: "PLA", color_name: "Оранжевый", color_hex: "#f6811f", location: "loc-shelf", initial: 1000, current: 42, nozzle: 205, bed: 55, price: 990, status: "almost_empty", opened: daysAgo(120), created: daysAgo(130) }),
    mkSpool({ id: "sp-pla-green", label: "PLA Зелёный", sku: "SL-PLA-GR", brand: "SUNLU", material: "PLA", color_name: "Зелёный", color_hex: "#17a34a", location: "loc-shelf", initial: 1000, current: 0, nozzle: 205, bed: 55, price: 990, status: "empty", opened: daysAgo(150), created: daysAgo(160) }),
    mkSpool({ id: "sp-petg-black", label: "PETG Чёрный (запас)", sku: "ES-PETG-BK", brand: "eSun", material: "PETG", color_name: "Чёрный", color_hex: "#141414", location: "loc-stock", initial: 1000, current: 1000, nozzle: 240, bed: 75, price: 1290, status: "new", created: daysAgo(15) }),
    mkSpool({ id: "sp-pla-silk-gold", label: "PLA Silk Золото", sku: "ES-SILK-GD", brand: "eSun", material: "PLA", color_name: "Золото", color_hex: "#c9a227", location: "loc-shelf", initial: 1000, current: 355, nozzle: 215, bed: 55, price: 1590, opened: daysAgo(55), created: daysAgo(75), specExtra: { material_type: "Silk", max_volumetric_speed: 10, drying_temp: 55, gtin: "6926492201099" } }),
    mkSpool({ id: "sp-abs-natural", label: "ABS Натуральный", sku: "PM-ABS-NT", brand: "Polymaker", material: "ABS", color_name: "Натуральный", color_hex: "#e8e2d4", location: "loc-drybox", initial: 1000, current: 585, nozzle: 245, bed: 100, fan: 0, price: 1890, opened: daysAgo(48), created: daysAgo(70) }),
  ];

  // События по катушкам — история движений + расход для графиков дашборда.
  const events = [];
  const ev = (spool_id, o) => events.push({
    id: uid(), spool_id, event_type: o.type, weight_before_g: o.before ?? null, weight_after_g: o.after ?? null,
    delta_g: o.delta ?? null, reason: o.reason || null, event_metadata: o.meta || null, created_at: o.at,
  });
  for (const s of spools) {
    ev(s.id, { type: "created", after: s.initial_filament_weight_g, at: s.created_at, reason: "Новая катушка" });
  }
  // Разбросанный расход печатей за последние ~5 месяцев (для графика по месяцам).
  const usageSeed = [
    ["sp-pla-black", 120, 3], ["sp-pla-black", 95, 20], ["sp-pla-black", 60, 48],
    ["sp-petg-blue", 210, 8], ["sp-petg-blue", 140, 35], ["sp-petg-blue", 180, 95],
    ["sp-pla-white", 85, 12], ["sp-pla-white", 100, 70],
    ["sp-tpu-red", 60, 15], ["sp-asa-grey", 90, 25], ["sp-pla-silk-gold", 150, 40],
    ["sp-pla-orange", 300, 60], ["sp-pla-orange", 400, 110], ["sp-pla-green", 500, 90],
    ["sp-abs-natural", 130, 33], ["sp-abs-natural", 160, 100],
  ];
  for (const [sid, g, d] of usageSeed) {
    ev(sid, { type: "print_usage", delta: -g, after: null, at: daysAgo(d), reason: `Печать deco_${sid.slice(3)}.gcode` });
  }
  // Пара сушек и перемещений для истории.
  ev("sp-asa-grey", { type: "dried", delta: 0, at: daysAgo(9), reason: "Сушка 80°C · 6 ч" });
  ev("sp-tpu-red", { type: "moved", delta: 0, at: daysAgo(28), reason: "Перемещение" });
  ev("sp-pla-black", { type: "weighed", delta: -12, at: daysAgo(2), reason: "Взвешивание" });

  // Принтеры: Anycubic Kobra S1 Combo (Moonraker/ACE Pro + сушка) и ручной Prusa.
  const pAce = {
    id: "pr-ace", owner_user_id: USER.id, name: "Kobra S1 (мастерская)", integration_type: "moonraker",
    brand: "Anycubic", model: "Kobra S1 Combo",
    capabilities: { has_mmu: true, mmu_slots: 4, mmu_name: "ACE Pro", has_dryer: true, has_chamber: true, tool_count: 4, controls: ["dryer_start_stop"] },
    moonraker_url: "http://192.168.1.50:7125", moonraker_api_key_encrypted: null, is_active: true, notes: null,
    has_moonraker_key: false, created_at: daysAgo(120), updated_at: nowIso(),
    // демо-состояние живого принтера
    _print: { startedAt: Date.now() - 22 * 60000, totalSec: 95 * 60, file: "bracket_v3_PLA_0.2mm.gcode" },
    _dryer: { unit: 0, status: "stop", temp: 24, target_temp: 0, remaining_min: 0, duration_min: 0, humidity: 18 },
  };
  const pManual = {
    id: "pr-prusa", owner_user_id: USER.id, name: "Prusa MK4", integration_type: "manual",
    brand: "Prusa Research", model: "MK4", capabilities: {}, moonraker_url: null, moonraker_api_key_encrypted: null,
    is_active: true, notes: "Ручной учёт", has_moonraker_key: false, created_at: daysAgo(140), updated_at: nowIso(),
  };
  const printers = [pAce, pManual];

  // Слоты ACE: 4 слота, три с катушками (совпадают с гейтами).
  const slots = [
    { id: "slot-1", printer_id: "pr-ace", slot_index: 1, name: null, current_spool_id: "sp-pla-black", is_active: true },
    { id: "slot-2", printer_id: "pr-ace", slot_index: 2, name: null, current_spool_id: "sp-pla-white", is_active: true },
    { id: "slot-3", printer_id: "pr-ace", slot_index: 3, name: null, current_spool_id: "sp-petg-blue", is_active: true },
    { id: "slot-4", printer_id: "pr-ace", slot_index: 4, name: null, current_spool_id: null, is_active: true },
  ];
  const slotHistory = [
    { id: uid(), printer_slot_id: "slot-1", spool_id: "sp-pla-black", user_id: USER.id, assigned_at: daysAgo(40), unassigned_at: null, notes: null },
    { id: uid(), printer_slot_id: "slot-3", spool_id: "sp-petg-blue", user_id: USER.id, assigned_at: daysAgo(30), unassigned_at: null, notes: null },
  ];

  // История заданий Moonraker (для панели и кнопки «Списать»).
  const t0 = Math.floor(Date.now() / 1000);
  const mrJobs = [
    { job_id: "mrj-1004", filename: "phone_stand_PETG_0.2.gcode", status: "completed", start_time: t0 - 26 * 3600, end_time: t0 - 25 * 3600, print_duration_sec: 3120, total_duration_sec: 3400, filament_used_mm: 8600, filament_total_g: 25.7, slicer: "OrcaSlicer" },
    { job_id: "mrj-1003", filename: "gridfinity_bin_PLA_0.2.gcode", status: "completed", start_time: t0 - 3 * 86400, end_time: t0 - 3 * 86400 + 5400, print_duration_sec: 5400, total_duration_sec: 5600, filament_used_mm: 15200, filament_total_g: 45.4, slicer: "OrcaSlicer", _consumed: "pj-3001" },
    { job_id: "mrj-1002", filename: "vase_spiral_PLA_0.3.gcode", status: "completed", start_time: t0 - 6 * 86400, end_time: t0 - 6 * 86400 + 7200, print_duration_sec: 7200, total_duration_sec: 7400, filament_used_mm: 21000, filament_total_g: 62.8, slicer: "OrcaSlicer", _consumed: "pj-3002" },
    { job_id: "mrj-1001", filename: "calibration_cube_PLA.gcode", status: "cancelled", start_time: t0 - 8 * 86400, end_time: t0 - 8 * 86400 + 300, print_duration_sec: 240, total_duration_sec: 300, filament_used_mm: 900, filament_total_g: 2.7, slicer: "OrcaSlicer" },
  ];

  // Печати (история). Пара уже списанных + черновик.
  const printJobs = [
    {
      id: "pj-3001", printer_id: "pr-ace", source: "moonraker", file_name: "gridfinity_bin_PLA_0.2.gcode",
      slicer_name: "OrcaSlicer", slicer_version: "2.1.1", estimated_print_time_sec: 5400, filament_change_count: 0,
      total_filament_used_g: 45.4, total_filament_used_mm: 15200, status: "consumed", created_at: daysAgo(3), completed_at: daysAgo(3),
      parsed_metadata: { moonraker_job_id: "mrj-1003" },
      tools: [{ id: uid(), tool_index: 0, slot_index: 1, material: "PLA", color_hex: "#1a1a1a", used_g: 45.4, used_mm: 15200 }],
      spool_usage: [{ id: uid(), spool_id: "sp-pla-black", printer_slot_id: "slot-1", tool_index: 0, used_g: 45.4, confirmed_at: daysAgo(3) }],
    },
    {
      id: "pj-3002", printer_id: "pr-ace", source: "moonraker", file_name: "vase_spiral_PLA_0.3.gcode",
      slicer_name: "OrcaSlicer", slicer_version: "2.1.1", estimated_print_time_sec: 7200, filament_change_count: 0,
      total_filament_used_g: 62.8, total_filament_used_mm: 21000, status: "consumed", created_at: daysAgo(6), completed_at: daysAgo(6),
      parsed_metadata: { moonraker_job_id: "mrj-1002" },
      tools: [{ id: uid(), tool_index: 0, slot_index: 2, material: "PLA", color_hex: "#f4f4f4", used_g: 62.8, used_mm: 21000 }],
      spool_usage: [{ id: uid(), spool_id: "sp-pla-white", printer_slot_id: "slot-2", tool_index: 0, used_g: 62.8, confirmed_at: daysAgo(6) }],
    },
    {
      id: "pj-3003", printer_id: null, source: "gcode", file_name: "multicolor_logo.gcode",
      slicer_name: "OrcaSlicer", slicer_version: "2.1.1", estimated_print_time_sec: 4800, filament_change_count: 2,
      total_filament_used_g: 38.2, total_filament_used_mm: 12700, status: "draft", created_at: daysAgo(1), completed_at: null,
      parsed_metadata: {},
      tools: [
        { id: uid(), tool_index: 0, slot_index: null, material: "PLA", color_hex: "#1a1a1a", used_g: 18.1, used_mm: 6000 },
        { id: uid(), tool_index: 1, slot_index: null, material: "PLA", color_hex: "#d6263a", used_g: 20.1, used_mm: 6700 },
      ],
      spool_usage: [],
    },
  ];

  return {
    user: USER, locations, profiles, spools, events, printers, slots, slotHistory,
    mrJobs, printJobs,
    settings: {
      allow_negative_consumption: false, moonraker_auto_import: true, moonraker_auto_consume: false, error_logging: false,
      spool_low_pct: LOW_DEFAULTS.pct, spool_low_min_g: LOW_DEFAULTS.min_g, spool_low_max_g: LOW_DEFAULTS.max_g,
      // Датчики Home Assistant: в демо «подключены», чтобы показания было видно
      // на панели и в местах хранения — значения генерируются локально.
      humidity_alert_max_pct: 45, ha_enabled: true, ha_base_url: "http://homeassistant.local:8123", ha_token_set: true,
      ha_sensors: [
        // У сушилки свой порог: нагрев занижает относительную влажность, общие 45 % там не сработают.
        { id: "env-ace", name: "Сушилка ACE Pro", temp_entity: "sensor.ace_pro_temp_hum_temperature", humidity_entity: "sensor.ace_pro_temp_hum_humidity", battery_entity: "sensor.ace_pro_temp_hum_battery", humidity_max: 25, bind_type: "printer", bind_id: "pr-ace" },
        { id: "env-drybox", name: "Сухобокс", temp_entity: "sensor.drybox_temperature", humidity_entity: "sensor.drybox_humidity", battery_entity: "", humidity_max: null, bind_type: "location", bind_id: "loc-drybox" },
      ],
    },
    seq: 4100,
  };
}

// ---------------------------------------------------------------------------
// Хранилище
// ---------------------------------------------------------------------------
let db = null;
function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) db = JSON.parse(raw);
  } catch { /* ignore */ }
  if (!db) { db = seed(); save(); }
  return db;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { /* quota */ }
}
export function resetDemo() {
  localStorage.removeItem(STORE_KEY);
  db = null;
  if (typeof window !== "undefined") window.location.reload();
}

// Автовход: подставляем токен, чтобы миновать экран логина.
if (DEMO && typeof window !== "undefined") {
  if (!localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, "demo-token");
  load();
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------
class ApiError extends Error {
  constructor(detail, status = 400) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
  }
}
const notFound = (m = "Не найдено") => new ApiError(m, 404);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function profileOf(sp) {
  return db.profiles.find((p) => p.id === sp.filament_profile_id) || null;
}
function recompute(sp) {
  if (sp.status === "archived") return;
  const left = Number(sp.current_weight_g);
  if (left <= 0) sp.status = "empty";
  else if (left <= lowThresholdG(sp.initial_filament_weight_g)) sp.status = "almost_empty";
  else if (sp.status !== "new") sp.status = "in_use";
}
function addEvent(spoolId, { type, before, after, delta, reason, meta }) {
  db.events.push({
    id: uid(), spool_id: spoolId, event_type: type, weight_before_g: before ?? null,
    weight_after_g: after ?? null, delta_g: delta ?? null, reason: reason || null,
    event_metadata: meta || null, created_at: nowIso(),
  });
}
function pricePerGram(sp) {
  const created = db.events.find((e) => e.spool_id === sp.id && e.event_type === "created");
  const base = Number(created?.weight_after_g) || Number(sp.initial_filament_weight_g) || 0;
  if (sp.price == null || !base) return null;
  return [Number(sp.price) / base, sp.currency || "RUB"];
}
function displayName(sp) {
  const p = profileOf(sp);
  let brand = sp.manufacturer || p?.brand;
  const name = p?.name || sp.label;
  if (brand && name && name.toLowerCase().startsWith(brand.toLowerCase())) brand = null;
  return [brand, name].filter(Boolean).join(" ") || "Без метки";
}

// Живой статус печати ACE — прогресс тикает от startedAt, по кругу.
function liveStatus(printer) {
  const pr = printer._print;
  if (!pr) return { state: "ready", filename: null, progress: null, nozzle_temp: 24, bed_temp: 24 };
  const elapsed = ((Date.now() - pr.startedAt) / 1000) % pr.totalSec;
  const progress = Math.min(0.999, elapsed / pr.totalSec);
  const d = printer._dryer;
  return {
    state: "printing",
    filename: pr.file,
    print_duration_sec: Math.round(elapsed),
    total_duration_sec: pr.totalSec,
    filament_used_mm: Math.round(progress * 14500),
    progress,
    nozzle_temp: 219 + Math.sin(elapsed / 30) * 1.5,
    nozzle_target: 220,
    bed_temp: 55 + Math.sin(elapsed / 45) * 0.6,
    bed_target: 55,
    part_fan: 1, box_fan: 0.4, air_filter_fan: 0.3, speed_factor: 1, extrude_factor: 1,
    _dryer_active: d?.status === "drying",
  };
}
// Режимы подачи филамента — как на бэке (app/services/feed_mode.py).
const FEED_MODES = ["auto", "mmu", "direct"];

function gatesFor(printer) {
  const slots = db.slots.filter((s) => s.printer_id === printer.id);
  const byIndex = Object.fromEntries(slots.map((s) => [s.slot_index, s]));
  const n = printer.capabilities?.mmu_slots || 0;
  const gates = [];
  for (let i = 0; i < n; i++) {
    const slot = byIndex[i + 1];
    const sp = slot?.current_spool_id ? db.spools.find((x) => x.id === slot.current_spool_id) : null;
    const occupied = !!sp;
    gates.push({
      gate: i, slot_index: i + 1, occupied,
      material: sp?.material || null, color_hex: sp?.color_hex || null, temp: occupied ? 26 : null,
      spool: sp ? { id: sp.id, label: sp.label, material: sp.material, color_hex: sp.color_hex, color_name: sp.color_name } : null,
      verdict: occupied ? "match" : "empty",
    });
  }
  return gates;
}
function dryerRemaining(printer) {
  const d = printer._dryer;
  if (!d || d.status !== "drying") return d;
  const elapsed = (Date.now() - (d._startedAt || Date.now())) / 60000;
  return { ...d, remaining_min: Math.max(0, Math.round((d.duration_min || 0) - elapsed)) };
}

// Аннотация заданий Moonraker признаком списания.
function annotateMrJobs(jobs) {
  return jobs.map((j) => {
    const pj = j._consumed ? db.printJobs.find((p) => p.id === j._consumed) : null;
    const consumed = !!(pj && pj.status === "consumed");
    let cost = null, currency = null;
    if (pj) {
      const c = jobCost(pj);
      if (c) { cost = c.cost; currency = c.currency; }
    }
    return {
      job_id: j.job_id, filename: j.filename, status: j.status, start_time: j.start_time, end_time: j.end_time,
      print_duration_sec: j.print_duration_sec, total_duration_sec: j.total_duration_sec,
      filament_used_mm: j.filament_used_mm, filament_total_g: j.filament_total_g, slicer: j.slicer,
      consumed, consumed_via: consumed ? "moonraker" : null, print_job_id: pj ? pj.id : null,
      cost: cost != null ? Math.round(cost * 100) / 100 : null, cost_currency: currency,
    };
  });
}
function jobCost(pj) {
  let cost = 0, currency = null, partial = false, any = false, grams = 0;
  for (const u of pj.spool_usage || []) {
    const sp = db.spools.find((s) => s.id === u.spool_id);
    grams += Number(u.used_g) || 0;
    const ppg = sp ? pricePerGram(sp) : null;
    if (ppg) { cost += Number(u.used_g) * ppg[0]; currency = currency || ppg[1]; any = true; }
    else partial = true;
  }
  if (!any) return null;
  return { cost, currency, partial, grams };
}

// ---------------------------------------------------------------------------
// Дашборд
// ---------------------------------------------------------------------------
const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const ACTIVITY_TYPE = { created: "added", print_usage: "used", manual_adjustment: "updated", weighed: "updated", moved: "moved", archived: "updated", dried: "updated" };

// Показания датчиков для демо. Значения слегка «дышат» вокруг правдоподобных:
// в сушилке жарко и сухо, в сухобоксе прохладно и чуть выше порога — чтобы на
// панели было видно и обычное состояние, и подсветку превышения.
function buildEnvironment() {
  const drift = (base, spread) => Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10;
  const BASE = {
    "env-ace": { temperature: 46.3, humidity: 27.9, battery: 95 },
    "env-drybox": { temperature: 22.4, humidity: 47.5, battery: null },
  };
  const now = new Date().toISOString();
  return {
    humidity_alert_max_pct: db.settings.humidity_alert_max_pct ?? 45,
    sensors: (db.settings.ha_sensors || []).map((s) => {
      const base = BASE[s.id] || { temperature: 23, humidity: 40, battery: null };
      return {
        id: s.id, name: s.name,
        temperature: drift(base.temperature, 0.6),
        humidity: drift(base.humidity, 1.2),
        battery: base.battery,
        // Как на сервере: свой порог датчика либо общий.
        humidity_max: s.humidity_max ?? (db.settings.humidity_alert_max_pct ?? 45),
        updated_at: now,
        bind_type: s.bind_type, bind_id: s.bind_id,
        error: null,
      };
    }),
  };
}

function buildDashboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const since30 = Date.now() - 30 * 86400000;
  const spools = db.spools;
  const active = spools.filter((s) => s.status !== "archived");
  const estLeft = active.reduce((a, s) => a + Number(s.current_weight_g), 0);
  const low = active.filter((s) => s.status === "almost_empty" || s.status === "empty");
  const addedThisMonth = spools.filter((s) => new Date(s.created_at).getTime() >= monthStart).length;

  const events = [...db.events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // расход по месяцам (6) + за 30 дней
  const last6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last6.push([d.getFullYear(), d.getMonth()]);
  }
  const usageByMonth = {};
  const usageByMonthMat = {}; // тот же расход, разложенный по материалу катушки
  let consumed30 = 0, consumed30cost = 0, costCurrency = null;
  for (const e of events) {
    if (e.event_type === "print_usage" && e.delta_g != null) {
      const g = Math.max(0, -Number(e.delta_g));
      const ts = new Date(e.created_at);
      const key = `${ts.getFullYear()}-${ts.getMonth()}`;
      usageByMonth[key] = (usageByMonth[key] || 0) + g;
      const sp = db.spools.find((s) => s.id === e.spool_id);
      const material = (sp && (sp.material || profileOf(sp)?.material)) || "Прочее";
      (usageByMonthMat[key] || (usageByMonthMat[key] = {}))[material] =
        (usageByMonthMat[key][material] || 0) + g;
      if (ts.getTime() >= since30) {
        consumed30 += g;
        const ppg = sp ? pricePerGram(sp) : null;
        if (ppg) { consumed30cost += g * ppg[0]; costCurrency = costCurrency || ppg[1]; }
      }
    }
  }
  const monthlyUsage = last6.map(([y, m]) => {
    const byMat = usageByMonthMat[`${y}-${m}`] || {};
    return {
      label: MONTHS_RU[m],
      grams: Math.round(usageByMonth[`${y}-${m}`] || 0),
      by_material: Object.fromEntries(Object.entries(byMat).map(([k, v]) => [k, Math.round(v)])),
    };
  });

  // распределение по материалам
  const mat = {};
  for (const s of active) {
    const p = profileOf(s);
    const material = s.material || p?.material || "Прочее";
    mat[material] = (mat[material] || 0) + Number(s.current_weight_g);
  }
  const materialDistribution = Object.entries(mat).map(([material, grams]) => ({ material, grams: Math.round(grams) })).sort((a, b) => b.grams - a.grams);

  // мало осталось
  const lowStock = [...low].sort((a, b) => Number(a.current_weight_g) - Number(b.current_weight_g)).slice(0, 4).map((s) => {
    const p = profileOf(s);
    const capacity = Number(s.initial_filament_weight_g) || 1000;
    const remaining = Number(s.current_weight_g);
    return {
      id: s.id, name: displayName(s), sub: s.color_name || p?.color_name || s.label || "",
      color_hex: s.color_hex || p?.color_hex, remaining_g: Math.round(remaining),
      pct: capacity ? Math.max(0, Math.min(1, remaining / capacity)) : 0,
    };
  });

  // напоминания о сушке
  const lastDried = {};
  for (const e of events) if (e.event_type === "dried" && !(e.spool_id in lastDried)) lastDried[e.spool_id] = new Date(e.created_at);
  const dryingAlerts = [];
  for (const s of active) {
    if (Number(s.current_weight_g) <= 0) continue;
    const p = profileOf(s);
    const material = s.material || p?.material;
    const threshold = dryingThresholdDays(material);
    if (threshold == null) continue;
    let ref = lastDried[s.id];
    if (!ref) ref = s.opened_date ? new Date(s.opened_date) : new Date(s.created_at);
    const days = Math.floor((Date.now() - ref.getTime()) / 86400000);
    if (days >= threshold) dryingAlerts.push({ id: s.id, name: displayName(s), material, days, threshold });
  }
  dryingAlerts.sort((a, b) => b.days - a.days);

  // печатей за 30 дней
  const recentJobs = db.printJobs.filter((j) => j.status === "consumed" && j.completed_at && new Date(j.completed_at).getTime() >= since30);
  const failed30 = recentJobs.filter((j) => j.parsed_metadata?.failed).length;

  // активность
  const recentActivity = events.slice(0, 6).map((e) => {
    const s = db.spools.find((x) => x.id === e.spool_id);
    let amount = null;
    if (e.event_type === "print_usage" && e.delta_g != null) amount = `${Number(e.delta_g).toFixed(0)}g`;
    else if (e.event_type === "created" && e.weight_after_g != null) amount = `+${Number(e.weight_after_g).toFixed(0)}g`;
    else if (e.delta_g != null && Number(e.delta_g) !== 0) amount = `${Number(e.delta_g) > 0 ? "+" : ""}${Number(e.delta_g).toFixed(0)}g`;
    return {
      type: ACTIVITY_TYPE[e.event_type] || "updated", name: s ? displayName(s) : "—",
      sub: e.reason || { created: "Новая катушка", moved: "Перемещение" }[e.event_type] || "",
      amount, created_at: e.created_at,
    };
  });

  return {
    total_spools: active.length, added_this_month: addedThisMonth, low_stock_count: low.length,
    est_filament_left_g: Math.round(estLeft), est_print_hours: estLeft ? Math.round(estLeft / 55) : 0,
    recent_prints_30d: recentJobs.length, failed_30d: failed30, drying_alerts: dryingAlerts.slice(0, 5),
    consumed_30d_g: Math.round(consumed30), consumed_30d_cost: consumed30cost ? Math.round(consumed30cost * 100) / 100 : null,
    cost_currency: costCurrency, monthly_usage: monthlyUsage, material_distribution: materialDistribution,
    low_stock: lowStock, recent_activity: recentActivity,
  };
}

// ---------------------------------------------------------------------------
// Карточка/этикетка
// ---------------------------------------------------------------------------
function buildCard(sp) {
  const p = profileOf(sp);
  const empty = sp.empty_spool_weight_g != null ? Number(sp.empty_spool_weight_g) : null;
  const remaining = Number(sp.current_weight_g);
  const nozzle = sp.hotend_temp ? `${sp.hotend_temp}°C` : fmtTemp(p?.nozzle_temp_min, p?.nozzle_temp_max);
  const bed = sp.bed_temp ? `${sp.bed_temp}°C` : fmtTemp(p?.bed_temp_min, p?.bed_temp_max);
  return {
    spool_id: sp.id, label: sp.label || "Без метки", brand: sp.manufacturer || p?.brand || null,
    name: p?.name || sp.label, material: sp.material || p?.material || null,
    color_name: sp.color_name || p?.color_name || null, color_hex: sp.color_hex || p?.color_hex || null,
    nozzle_temp: nozzle, bed_temp: bed, pressure_advance: sp.specs?.pressure_advance ?? p?.pressure_advance ?? null,
    flow_ratio: sp.specs?.flow_ratio ?? p?.flow_ratio ?? null, max_volumetric_speed: p?.max_volumetric_speed ?? null,
    print_speed_mm_s: p?.print_speed_mm_s ?? null, fan_percent: sp.fan_speed ?? p?.fan_percent ?? null,
    diameter_mm: Number(sp.diameter_mm) || (p ? Number(p.diameter_mm) : null),
    density_g_cm3: sp.specs?.density ?? p?.density_g_cm3 ?? null, empty_spool_weight_g: empty,
    total_weight_g: empty != null ? empty + remaining : null, remaining_g: remaining,
    location_name: sp.location_id ? db.locations.find((l) => l.id === sp.location_id)?.name || null : null,
    opened_date: sp.opened_date || null, qr_token: sp.qr_token, qr_png_base64: fakeQr(sp.qr_token),
  };
}
function fmtTemp(a, b) {
  if (a && b && a !== b) return `${a}–${b}°C`;
  if (b) return `${b}°C`;
  if (a) return `${a}°C`;
  return "—";
}
// Псевдо-QR: детерминированная сетка из токена, как data-URL SVG.
function fakeQr(token) {
  const N = 11;
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0;
  let rects = "";
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      h = (h * 1103515245 + 12345) >>> 0;
      const corner = (x < 3 && y < 3) || (x > N - 4 && y < 3) || (x < 3 && y > N - 4);
      if (corner || h % 2 === 0) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges"><rect width="${N}" height="${N}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}
// Этикетка как SVG-blob (годится и для <img>, и для превью).
function labelSvg(sp, fields) {
  const card = buildCard(sp);
  const rows = (fields && fields.length ? fields : ["nozzle_temp", "bed_temp", "pressure_advance", "flow_info"])
    .filter((f) => f && f !== "none");
  const FIELD_LABEL = { nozzle_temp: "Сопло", bed_temp: "Стол", pressure_advance: "PA", flow_info: "Flow", fan: "Обдув", diameter: "Диаметр", density: "Плотность", remaining: "Остаток" };
  const val = (f) => ({
    nozzle_temp: card.nozzle_temp, bed_temp: card.bed_temp, pressure_advance: card.pressure_advance ?? "—",
    flow_info: card.max_volumetric_speed ? `${card.max_volumetric_speed} мм³/с` : (card.flow_ratio ?? "—"),
    fan: card.fan_percent != null ? `${card.fan_percent}%` : "—", diameter: `${card.diameter_mm || 1.75} мм`,
    density: card.density_g_cm3 ?? "—", remaining: `${Math.round(card.remaining_g)} г`,
  }[f] ?? "—");
  const lines = rows.map((f, i) => `<text x="12" y="${86 + i * 20}" font-size="13" fill="#111">${FIELD_LABEL[f] || f}: <tspan font-weight="700">${val(f)}</tspan></text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" font-family="sans-serif">
    <rect width="320" height="200" fill="#fff" stroke="#ccc"/>
    <rect x="0" y="0" width="8" height="200" fill="${card.color_hex || "#888"}"/>
    <image href="${card.qr_png_base64}" x="228" y="12" width="80" height="80"/>
    <text x="12" y="30" font-size="17" font-weight="700" fill="#111">${escapeXml(card.name || card.label)}</text>
    <text x="12" y="50" font-size="13" fill="#555">${escapeXml([card.brand, card.material, card.color_name].filter(Boolean).join(" · "))}</text>
    <line x1="12" y1="62" x2="308" y2="62" stroke="#eee"/>
    ${lines}
  </svg>`;
}
function escapeXml(s) { return String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

// Минимальный валидный PDF с текстом этикетки.
function labelPdf(sp) {
  const card = buildCard(sp);
  const text = [
    `${card.name || card.label}`,
    `${[card.brand, card.material, card.color_name].filter(Boolean).join("  ")}`,
    `Nozzle ${card.nozzle_temp}   Bed ${card.bed_temp}`,
    `Остаток ${Math.round(card.remaining_g)} g   ${card.qr_token}`,
  ];
  const content = `BT /F1 14 Tf 40 300 Td 18 TL (${text[0].replace(/[()\\]/g, "")}) Tj T* (${text[1].replace(/[()\\]/g, "")}) Tj T* (${text[2].replace(/[()\\]/g, "")}) Tj T* (${text[3].replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 360] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

// ---------------------------------------------------------------------------
// Каталог филамента (SpoolmanDB) — компактный демо-набор
// ---------------------------------------------------------------------------
const CATALOG = [
  ["Bambu Lab", "PLA Basic", "PLA", [["Чёрный", "#161616"], ["Белый", "#f5f5f5"], ["Красный", "#c0392b"], ["Синий", "#2456c8"], ["Золото", "#c9a227"]], 190, 230, 45, 65],
  ["Bambu Lab", "PETG HF", "PETG", [["Чёрный", "#141414"], ["Оранжевый", "#e8720c"], ["Зелёный", "#1f9d55"]], 230, 260, 70, 80],
  ["Polymaker", "PolyTerra PLA", "PLA", [["Army Green", "#5a6b3b"], ["Charcoal", "#36454f"], ["Sakura Pink", "#f4b6c2"]], 190, 230, 25, 60],
  ["Polymaker", "PolyLite ASA", "ASA", [["Чёрный", "#1a1a1a"], ["Серый", "#7a7d82"], ["Белый", "#eee"]], 240, 270, 90, 100],
  ["eSun", "PLA+", "PLA", [["Чёрный", "#111"], ["Белый", "#fafafa"], ["Красный", "#d21f2b"], ["Skin", "#f2c9a0"]], 205, 225, 45, 60],
  ["eSun", "PETG", "PETG", [["Синий", "#1d5fd6"], ["Прозрачный", "#dfe7ef"]], 230, 250, 70, 80],
  ["SUNLU", "PLA Meta", "PLA", [["Оранжевый", "#f6811f"], ["Зелёный", "#17a34a"], ["Фиолетовый", "#7b3fa0"]], 190, 220, 45, 60],
  ["SUNLU", "TPU 95A", "TPU", [["Красный", "#d6263a"], ["Чёрный", "#151515"]], 210, 235, 40, 50],
  ["Overture", "PLA Matte", "PLA", [["Space Grey", "#4b4f54"], ["Cream", "#efe6d2"]], 190, 220, 45, 60],
  ["Prusament", "PLA", "PLA", [["Galaxy Black", "#1b1d22"], ["Lipstick Red", "#b11226"], ["Ocean Blue", "#1273a8"]], 205, 225, 50, 60],
];
function catalogEntries() {
  const out = [];
  for (const [brand, name, material, colors, nmin, nmax, bmin, bmax] of CATALOG) {
    for (const [cn, ch] of colors) {
      out.push({
        catalog_id: `${brand}-${name}-${cn}`.replace(/\s/g, "_"), brand, name, material,
        color_name: cn, color_hex: ch, diameter_mm: 1.75, density_g_cm3: densityFor(material),
        nozzle_temp_min: nmin, nozzle_temp_max: nmax, bed_temp_min: bmin, bed_temp_max: bmax,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Пресеты принтеров (подмножество каталога)
// ---------------------------------------------------------------------------
const ACE_PRO = { has_mmu: true, mmu_slots: 4, mmu_name: "ACE Pro", has_dryer: true, tool_count: 4, controls: ["dryer_start_stop"] };
function mkPreset(brand, model, caps, note, integration = "moonraker") {
  const key = `${brand} ${model}`.toLowerCase().replace(/\//g, " ").replace(/\+/g, "plus").split(/\s+/).filter(Boolean).join("-");
  return { key, brand, model, integration_type: integration, capabilities: caps, note };
}
const PRESETS = [
  mkPreset("Anycubic", "Kobra 3", {}, "250×250×260 · через Rinkhals"),
  mkPreset("Anycubic", "Kobra 3 Combo", { ...ACE_PRO }, "250×250×260 · ACE Pro · через Rinkhals"),
  mkPreset("Anycubic", "Kobra S1", { has_chamber: true }, "250×250×250 · закрытая · через Rinkhals"),
  mkPreset("Anycubic", "Kobra S1 Combo", { ...ACE_PRO, has_chamber: true }, "250×250×250 · закрытая · ACE Pro · через Rinkhals"),
  mkPreset("Bambu Lab", "P1S", { has_chamber: true, tool_count: 1 }, "256×256×256 · закрытая"),
  mkPreset("Bambu Lab", "X1 Carbon", { has_chamber: true, tool_count: 1 }, "256×256×256 · закрытая"),
  mkPreset("Creality", "K1", { has_chamber: true }, "220×220×250 · закрытая · нужен root"),
  mkPreset("Creality", "K1 Max", { has_chamber: true }, "300×300×300 · закрытая · нужен root"),
  mkPreset("Creality", "Ender-3 V3 KE", {}, "220×220×240 · Moonraker зависит от прошивки"),
  mkPreset("ELEGOO", "Neptune 4 Plus", {}, "320×320×385 · Fluidd (форк ELEGOO)"),
  mkPreset("ELEGOO", "Neptune 4 Max", {}, "420×420×480 · Fluidd (форк ELEGOO)"),
  mkPreset("FLSUN", "V400", {}, "Ø300×410 · дельта · Klipper Speeder Pad"),
  mkPreset("Prusa Research", "MK4", { tool_count: 1 }, "250×210×220 · PrusaLink/Moonraker", "manual"),
  mkPreset("Prusa Research", "MK4 + MMU3", { has_mmu: true, mmu_slots: 5, mmu_name: "MMU3", tool_count: 1 }, "250×210×220 · 5 слотов"),
  mkPreset("QIDI", "Q1 Pro", { has_chamber: true }, "245×245×245 · закрытая"),
  mkPreset("Sovol", "SV08", {}, "350×350×345 · Voron-совместимый"),
  mkPreset("Voron", "2.4", { has_chamber: true }, "350×350×350 · self-build"),
];

// ---------------------------------------------------------------------------
// Диспетчер запросов
// ---------------------------------------------------------------------------
function parse(pathWithQuery) {
  const [path, qs] = pathWithQuery.split("?");
  const query = {};
  if (qs) for (const kv of qs.split("&")) { const [k, v] = kv.split("="); query[decodeURIComponent(k)] = decodeURIComponent(v || ""); }
  return { path, query };
}
const seg = (path) => path.replace(/^\/api\//, "").split("/");

// Основной обработчик JSON-запросов. Может бросить ApiError.
function dispatch(method, rawPath, { body, form, fileName } = {}) {
  load();
  const { path, query } = parse(rawPath);
  const parts = seg(path);
  const M = method.toUpperCase();
  const r = parts[0]; // ресурс

  // --- health / auth ---
  if (path === "/health") return { status: "ok", version: "demo" };
  if (path === "/api/auth/setup-status") return { needs_setup: false };
  if (path === "/api/auth/login") return { access_token: "demo-token", token_type: "bearer" };
  if (path === "/api/auth/me") return db.user;
  if (path === "/api/auth/me/theme" && M === "PUT") {
    db.user = { ...db.user, theme: body?.theme };
    save();
    return db.user;
  }
  if (path === "/api/auth/logout") return { detail: "ok" };

  // --- settings ---
  if (r === "settings") {
    if (M === "GET") return db.settings;
    if (M === "PUT") {
      Object.assign(db.settings, body || {});
      // Порог задаёт статусы, а не только момент уведомления (см. бэк:
      // app/api/settings.py::_recompute_spool_statuses).
      if (body?.spool_low_pct != null || body?.spool_low_min_g != null || body?.spool_low_max_g != null) db.spools.forEach(recompute);
      save();
      return db.settings;
    }
  }

  // --- diagnostics (в демо бэкенда нет — журнал всегда пуст) ---
  if (r === "diagnostics") {
    if (parts[1] === "log" && M === "GET")
      return { enabled: !!db.settings.error_logging, total: 0, entries: [] };
    if (parts[1] === "clear") return null;
    if (parts[1] === "client") return null;
  }

  // --- dashboard ---
  if (path === "/api/dashboard") return buildDashboard();

  // --- environment (в демо Home Assistant нет — показания генерируются) ---
  if (path === "/api/environment") return buildEnvironment();

  // --- catalog ---
  if (r === "filament-catalog") {
    if (parts[1] === "brands") {
      const counts = {};
      for (const e of catalogEntries()) counts[e.brand] = (counts[e.brand] || 0) + 1;
      return Object.entries(counts).map(([brand, count]) => ({ brand, count })).sort((a, b) => a.brand.localeCompare(b.brand));
    }
    if (parts[1] === "info") return { count: catalogEntries().length, updated_at: daysAgo(5), source: "SpoolmanDB (demo)" };
    if (parts[1] === "refresh") return { count: catalogEntries().length, updated_at: nowIso(), source: "SpoolmanDB (demo)" };
    if (parts[1] === "search") {
      let rows = catalogEntries();
      const q = (query.q || "").toLowerCase();
      if (query.brand) rows = rows.filter((e) => e.brand === query.brand);
      if (query.material) rows = rows.filter((e) => (e.material || "").toUpperCase() === query.material.toUpperCase());
      if (q && q.length >= 2) rows = rows.filter((e) => `${e.brand} ${e.name} ${e.color_name} ${e.material}`.toLowerCase().includes(q));
      else if (!query.brand && !query.material) return [];
      rows = rows.sort((a, b) => (a.brand || "").localeCompare(b.brand || "") || (a.name || "").localeCompare(b.name || ""));
      return rows.slice(0, Number(query.limit) || 50);
    }
  }

  // --- locations ---
  if (r === "locations") {
    if (M === "GET" && parts.length === 1) return db.locations;
    if (M === "POST") {
      const loc = { id: uid(), owner_user_id: db.user.id, name: body.name, parent_id: body.parent_id || null, description: body.description || null, created_at: nowIso() };
      db.locations.push(loc); save(); return loc;
    }
    if (M === "PATCH") {
      const loc = db.locations.find((l) => l.id === parts[1]);
      if (!loc) return null;
      if ("name" in body) loc.name = body.name;
      if ("parent_id" in body) loc.parent_id = body.parent_id || null;
      if ("description" in body) loc.description = body.description || null;
      save(); return loc;
    }
    if (M === "DELETE") {
      db.locations = db.locations.filter((l) => l.id !== parts[1]);
      db.spools.forEach((s) => { if (s.location_id === parts[1]) s.location_id = null; });
      save(); return null;
    }
  }

  // --- filament-profiles ---
  if (r === "filament-profiles") {
    if (M === "GET" && parts.length === 1) {
      let rows = db.profiles;
      if (query.q) { const q = query.q.toLowerCase(); rows = rows.filter((p) => `${p.brand} ${p.name} ${p.material} ${p.color_name}`.toLowerCase().includes(q)); }
      return rows;
    }
    if (M === "GET" && parts.length === 2) {
      const p = db.profiles.find((x) => x.id === parts[1]); if (!p) throw notFound("Профиль не найден"); return p;
    }
    if (M === "POST" && parts.length === 1) {
      const p = { id: uid(), owner_user_id: db.user.id, diameter_mm: 1.75, fan_percent: 100, is_public: false, specs: null, source_name: null, source_url: null, created_at: nowIso(), updated_at: nowIso(), ...body };
      db.profiles.unshift(p); save(); return p;
    }
    if (parts[2] === "duplicate" && M === "POST") {
      const src = db.profiles.find((x) => x.id === parts[1]); if (!src) throw notFound("Профиль не найден");
      const copy = { ...src, id: uid(), name: `${src.name} (копия)`, created_at: nowIso(), updated_at: nowIso() };
      if (query.new_color === "true") { copy.color_name = null; copy.color_hex = null; }
      db.profiles.unshift(copy); save(); return copy;
    }
    if (parts[1] === "import-slicer" && M === "POST") {
      const p = { id: uid(), owner_user_id: db.user.id, brand: "Импорт", name: (fileName || "slicer.json").replace(/\.[^.]+$/, ""), material: "PLA", color_name: null, color_hex: null, diameter_mm: 1.75, density_g_cm3: 1.24, nozzle_temp_min: 200, nozzle_temp_max: 220, bed_temp_min: 50, bed_temp_max: 60, fan_percent: 100, print_speed_mm_s: 200, is_public: false, specs: null, created_at: nowIso(), updated_at: nowIso() };
      db.profiles.unshift(p); save(); return p;
    }
    if (M === "PATCH" && parts.length === 2) {
      const p = db.profiles.find((x) => x.id === parts[1]); if (!p) throw notFound("Профиль не найден");
      Object.assign(p, body, { updated_at: nowIso() }); save(); return p;
    }
    if (M === "DELETE" && parts.length === 2) {
      db.profiles = db.profiles.filter((x) => x.id !== parts[1]); save(); return null;
    }
  }

  // --- spools ---
  if (r === "spools") return spoolsRoute(M, parts, query, body);

  // --- slots ---
  if (r === "slots") return slotsRoute(M, parts, body);

  // --- printers ---
  if (r === "printers") return printersRoute(M, parts, query, body);

  // --- print-jobs ---
  if (r === "print-jobs") return printJobsRoute(M, parts, body);

  // --- gcode ---
  if (path === "/api/gcode/parse" && M === "POST") {
    return {
      file_name: fileName || "upload.gcode", file_hash: uid(), slicer_name: "OrcaSlicer", slicer_version: "2.1.1",
      diameter_mm: 1.75, estimated_print_time_sec: 4500, filament_change_count: 1, tool_count: 2,
      total_filament_used_g: 34.6, total_filament_used_mm: 11500,
      tools: [
        { tool_index: 0, material: "PLA", color_hex: "#1a1a1a", used_g: 22.4, used_mm: 7450, density_g_cm3: 1.24 },
        { tool_index: 1, material: "PLA", color_hex: "#d6263a", used_g: 12.2, used_mm: 4050, density_g_cm3: 1.24 },
      ],
    };
  }

  // --- backup ---
  if (path === "/api/backup/import" && M === "POST") {
    return { filament_profiles: db.profiles.length, spools: db.spools.length, locations: db.locations.length, printers: db.printers.length, print_jobs: db.printJobs.length };
  }

  throw notFound(`Демо: нет обработчика для ${M} ${path}`);
}

function spoolsRoute(M, parts, query, body) {
  // коллекция
  if (parts.length === 1) {
    if (M === "GET") {
      let rows = [...db.spools].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (query.status_filter) rows = rows.filter((s) => s.status === query.status_filter);
      return rows;
    }
    if (M === "POST") {
      const initial = Number(body.initial_filament_weight_g) || 1000;
      const sp = {
        id: uid(), owner_user_id: db.user.id, filament_profile_id: body.filament_profile_id || null,
        location_id: body.location_id || null, label: body.label || null, sku: body.sku || null,
        manufacturer: body.manufacturer || null, barcode: body.barcode || null, photo: body.photo || null,
        material: body.material || null, color_name: body.color_name || null, color_hex: body.color_hex || null,
        diameter_mm: body.diameter_mm || 1.75, hotend_temp: body.hotend_temp || null, bed_temp: body.bed_temp || null,
        fan_speed: body.fan_speed ?? null, flow_rate: body.flow_rate ?? null, specs: body.specs || null,
        initial_filament_weight_g: initial, empty_spool_weight_g: body.empty_spool_weight_g ?? 220,
        current_weight_g: body.current_weight_g != null ? Number(body.current_weight_g) : initial,
        purchase_date: body.purchase_date || null, opened_date: body.opened_date || null,
        price: body.price ?? null, currency: body.currency || "RUB", notes: body.notes || null,
        status: "new", qr_token: uid().replace(/-/g, "").slice(0, 12), created_at: nowIso(), updated_at: nowIso(),
      };
      db.spools.unshift(sp);
      addEvent(sp.id, { type: "created", after: sp.current_weight_g, reason: "Новая катушка" });
      save(); return sp;
    }
  }
  // спец-коллекции
  if (parts[1] === "label-options") {
    return {
      sizes: [
        { key: "classic", width_mm: 62, height_mm: 29 },
        { key: "square", width_mm: 50, height_mm: 50 },
        { key: "small", width_mm: 40, height_mm: 20 },
      ],
      fields: [
        { key: "none", label: "— нет —" }, { key: "nozzle_temp", label: "Сопло" }, { key: "bed_temp", label: "Стол" },
        { key: "pressure_advance", label: "Pressure Advance" }, { key: "flow_info", label: "Поток / скорость" },
        { key: "fan", label: "Обдув" }, { key: "diameter", label: "Диаметр" }, { key: "density", label: "Плотность" },
        { key: "remaining", label: "Остаток" },
      ],
      default_fields: ["nozzle_temp", "bed_temp", "pressure_advance", "flow_info"],
    };
  }
  if (parts[1] === "import-spoolman") return { imported: 6, skipped: 2, total: 8 };

  // элемент
  const id = parts[1];
  const sp = db.spools.find((s) => s.id === id);
  const sub = parts[2];

  if (!sub) {
    if (M === "GET") { if (!sp) throw notFound("Катушка не найдена"); return sp; }
    if (M === "PATCH") {
      if (!sp) throw notFound("Катушка не найдена");
      Object.assign(sp, body, { updated_at: nowIso() });
      if (body.current_weight_g != null) recompute(sp);
      if (body.status) sp.status = body.status;
      save(); return sp;
    }
    if (M === "DELETE") {
      db.spools = db.spools.filter((s) => s.id !== id);
      db.events = db.events.filter((e) => e.spool_id !== id);
      db.slots.forEach((sl) => { if (sl.current_spool_id === id) sl.current_spool_id = null; });
      save(); return null;
    }
  }
  if (!sp) throw notFound("Катушка не найдена");

  if (sub === "placement" && M === "GET") {
    const slot = db.slots.find((s) => s.current_spool_id === sp.id);
    let slotInfo = null;
    if (slot) {
      const pr = db.printers.find((p) => p.id === slot.printer_id);
      slotInfo = { slot_id: slot.id, printer_id: slot.printer_id, printer_name: pr?.name || null, slot_index: slot.slot_index, slot_name: slot.name };
    }
    return { location_id: sp.location_id || null, location_name: sp.location_id ? db.locations.find((l) => l.id === sp.location_id)?.name || null : null, slot: slotInfo };
  }
  if (sub === "card" && M === "GET") return buildCard(sp);
  if (sub === "events" && M === "GET") return db.events.filter((e) => e.spool_id === sp.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (sub === "weigh" && M === "POST") {
    const before = Number(sp.current_weight_g);
    const empty = Number(sp.empty_spool_weight_g) || 0;
    const after = Math.max(0, Number(body.total_weight_g) - empty);
    sp.current_weight_g = after; recompute(sp);
    addEvent(sp.id, { type: "weighed", before, after, delta: after - before, reason: body.reason || "Взвешивание" });
    save(); return sp;
  }
  if (sub === "adjust" && M === "POST") {
    const before = Number(sp.current_weight_g);
    let after = before;
    if (body.new_weight_g != null) after = Number(body.new_weight_g);
    else if (body.delta_g != null) after = before + Number(body.delta_g);
    after = Math.max(0, after);
    sp.current_weight_g = after; recompute(sp);
    addEvent(sp.id, { type: "manual_adjustment", before, after, delta: after - before, reason: body.reason || "Корректировка" });
    save(); return sp;
  }
  if (sub === "dry" && M === "POST") {
    addEvent(sp.id, { type: "dried", before: sp.current_weight_g, after: sp.current_weight_g, delta: 0, reason: `Сушка ${body.temp_c || "?"}°C · ${body.hours || "?"} ч` });
    if (body.temp_c || body.hours) sp.specs = { ...(sp.specs || {}), drying_temp: body.temp_c, dry_time_hours: body.hours };
    save(); return sp;
  }
  if (sub === "move" && M === "POST") {
    sp.location_id = body.location_id || null;
    db.slots.forEach((sl) => { if (sl.current_spool_id === sp.id) sl.current_spool_id = null; });
    addEvent(sp.id, { type: "moved", before: sp.current_weight_g, after: sp.current_weight_g, delta: 0, reason: "Перемещение" });
    save(); return sp;
  }
  if (sub === "duplicate" && M === "POST") {
    const copy = { ...sp, id: uid(), qr_token: uid().replace(/-/g, "").slice(0, 12), status: "new", created_at: nowIso(), updated_at: nowIso() };
    if (query.new_color === "true") { copy.color_name = null; copy.color_hex = null; }
    db.spools.unshift(copy);
    addEvent(copy.id, { type: "created", after: copy.current_weight_g, reason: "Новая катушка" });
    save(); return copy;
  }
  throw notFound("Катушка не найдена");
}

function slotToOut(slot) {
  let label = null;
  if (slot.current_spool_id) { const sp = db.spools.find((s) => s.id === slot.current_spool_id); label = sp ? (sp.label || "Без метки") : null; }
  return { id: slot.id, printer_id: slot.printer_id, slot_index: slot.slot_index, name: slot.name, current_spool_id: slot.current_spool_id, is_active: slot.is_active, current_spool_label: label };
}
function slotsRoute(M, parts, body) {
  const slot = db.slots.find((s) => s.id === parts[1]);
  const sub = parts[2];
  if (!slot) throw notFound("Слот не найден");
  if (sub === "assign-spool" && M === "POST") {
    // снять катушку с других слотов
    db.slots.forEach((s) => { if (s.current_spool_id === body.spool_id) s.current_spool_id = null; });
    slot.current_spool_id = body.spool_id;
    db.slotHistory.unshift({ id: uid(), printer_slot_id: slot.id, spool_id: body.spool_id, user_id: db.user.id, assigned_at: nowIso(), unassigned_at: null, notes: body.notes || null });
    save(); return slotToOut(slot);
  }
  if (sub === "unassign-spool" && M === "POST") {
    const h = db.slotHistory.find((x) => x.printer_slot_id === slot.id && x.spool_id === slot.current_spool_id && !x.unassigned_at);
    if (h) h.unassigned_at = nowIso();
    slot.current_spool_id = null; save(); return slotToOut(slot);
  }
  if (sub === "history" && M === "GET") return db.slotHistory.filter((x) => x.printer_slot_id === slot.id).sort((a, b) => new Date(b.assigned_at) - new Date(a.assigned_at));
  if (M === "PATCH") { Object.assign(slot, body); save(); return slotToOut(slot); }
  if (M === "DELETE") { db.slots = db.slots.filter((s) => s.id !== slot.id); save(); return null; }
  throw notFound("Слот не найден");
}

function printerOut(p) {
  return {
    id: p.id, owner_user_id: p.owner_user_id, name: p.name, integration_type: p.integration_type,
    brand: p.brand, model: p.model, capabilities: p.capabilities || {}, moonraker_url: p.moonraker_url,
    is_active: p.is_active, notes: p.notes, has_moonraker_key: !!p.moonraker_api_key_encrypted,
    feed_state: p._feed || null,
    created_at: p.created_at, updated_at: p.updated_at,
  };
}
// Наблюдение за режимом подачи (см. app/services/feed_mode.py::observe).
// Первое наблюдение только запоминается — подтверждать нечего.
function observeFeed(printer, mode) {
  const resolved = mode || resolvedFeedMode(printer);
  const prev = printer._feed;
  if (prev && prev.mode === resolved) return prev;
  printer._feed = {
    mode: resolved,
    prev: prev ? prev.mode : null,
    changed_at: new Date().toISOString(),
    confirmed: !prev,
  };
  save();
  return printer._feed;
}
// Внешняя катушка (держатель) — слот 0, как на бэке (slot_service.ensure_holder).
// Заводится у принтеров с хабом при первой прямой подаче; катушка из слота 1
// переезжает на него, потому что раньше держатель жил именно там.
const HOLDER_INDEX = 0;
function ensureHolder(printer) {
  let holder = db.slots.find((s) => s.printer_id === printer.id && s.slot_index === HOLDER_INDEX);
  if (holder) return holder;
  holder = { id: uid(), printer_id: printer.id, slot_index: HOLDER_INDEX, name: "Внешняя катушка", current_spool_id: null, is_active: true };
  db.slots.push(holder);
  const first = db.slots.find((s) => s.printer_id === printer.id && s.slot_index === 1);
  if (first?.current_spool_id) { holder.current_spool_id = first.current_spool_id; first.current_spool_id = null; }
  save();
  return holder;
}
function hasHub(printer) {
  const c = printer.capabilities || {};
  return !!(c.has_mmu || c.mmu_slots || c.mmu_off);
}
function resolvedFeedMode(printer) {
  const setting = FEED_MODES.includes(printer.capabilities?.feed_mode) ? printer.capabilities.feed_mode : "auto";
  if (setting === "direct") return "direct";
  return printer.capabilities?.has_mmu ? "mmu" : "direct";
}
function printersRoute(M, parts, query, body) {
  if (parts[1] === "presets") return PRESETS;
  if (parts.length === 1) {
    if (M === "GET") return [...db.printers].sort((a, b) => a.name.localeCompare(b.name)).map(printerOut);
    if (M === "POST") {
      const preset = PRESETS.find((p) => p.key === body.preset_key);
      const caps = body.capabilities || preset?.capabilities || {};
      const p = {
        id: uid(), owner_user_id: db.user.id, name: body.name, integration_type: body.integration_type || preset?.integration_type || "manual",
        brand: body.brand || preset?.brand || null, model: body.model || preset?.model || null, capabilities: caps,
        moonraker_url: body.moonraker_url || null, moonraker_api_key_encrypted: body.moonraker_api_key ? "enc" : null,
        is_active: body.is_active !== false, notes: body.notes || null, created_at: nowIso(), updated_at: nowIso(),
      };
      db.printers.push(p);
      const count = Number(body.slot_count) || caps.mmu_slots || 0;
      for (let i = 1; i <= count; i++) db.slots.push({ id: uid(), printer_id: p.id, slot_index: i, name: null, current_spool_id: null, is_active: true });
      save(); return printerOut(p);
    }
  }
  const printer = db.printers.find((p) => p.id === parts[1]);
  if (!printer) throw notFound("Принтер не найден");
  const sub = parts[2];

  if (!sub) {
    if (M === "GET") return printerOut(printer);
    if (M === "PATCH") { Object.assign(printer, body, { updated_at: nowIso() }); save(); return printerOut(printer); }
    if (M === "DELETE") {
      db.slots = db.slots.filter((s) => s.printer_id !== printer.id);
      db.printers = db.printers.filter((p) => p.id !== printer.id);
      db.printJobs.forEach((j) => { if (j.printer_id === printer.id) j.printer_id = null; });
      save(); return null;
    }
  }
  const moonrakerOnly = () => { if (printer.integration_type !== "moonraker") throw new ApiError("Принтер без интеграции Moonraker", 400); };

  if (sub === "slots") {
    const slots = db.slots.filter((s) => s.printer_id === printer.id).sort((a, b) => a.slot_index - b.slot_index);
    if (M === "GET") return slots.map(slotToOut);
    if (M === "POST") {
      const idx = body.slot_index || (slots.reduce((m, s) => Math.max(m, s.slot_index), 0) + 1);
      const slot = { id: uid(), printer_id: printer.id, slot_index: idx, name: body.name || null, current_spool_id: null, is_active: body.is_active !== false };
      db.slots.push(slot); save(); return slotToOut(slot);
    }
  }
  if (sub === "test-connection" && M === "POST") {
    if (printer.integration_type === "manual") return { ok: true, detail: "Ручной принтер — проверка не требуется" };
    return { ok: true, detail: "Подключено. Состояние: printing" };
  }
  if (sub === "status" && M === "GET") { moonrakerOnly(); return liveStatus(printer); }
  // Превью модели: в демо gcode-файлов нет, поэтому картинки не будет.
  if (sub === "thumbnail" && M === "GET") { moonrakerOnly(); return { thumbnail: null }; }
  // Режим подачи (см. app/services/feed_mode.py). В демо телеметрии нет, поэтому
  // «авто» ведёт себя как мультиподача, если она есть у модели.
  if (sub === "feed-mode" && M === "POST") {
    if (!FEED_MODES.includes(body?.mode)) throw new ApiError(`Неизвестный режим подачи: ${body?.mode}`, 422);
    printer.capabilities = { ...(printer.capabilities || {}), feed_mode: body.mode };
    if (body.mode === "direct" && hasHub(printer)) ensureHolder(printer);
    if (body.mode !== "auto") {
      const mine = db.slots.filter((s) => s.printer_id === printer.id);
      const holder = mine.some((s) => s.slot_index === HOLDER_INDEX);
      mine.forEach((s) => {
        if (body.mode === "mmu") s.is_active = s.slot_index !== HOLDER_INDEX;
        else s.is_active = holder ? s.slot_index === HOLDER_INDEX : s.slot_index <= 1;
      });
    }
    // Смена режима = железо переставили: катушки надо подтвердить заново
    // (на бэке это feed_mode.observe по телеметрии, тут — по выбору).
    observeFeed(printer);
    save(); return printerOut(printer);
  }
  if (sub === "feed-confirm" && M === "POST") {
    for (const item of body?.slots || []) {
      const slot = db.slots.find((s) => s.id === item.slot_id && s.printer_id === printer.id);
      if (!slot) continue;
      if (item.spool_id) {
        db.slots.filter((s) => s.current_spool_id === item.spool_id && s.id !== slot.id)
          .forEach((s) => { s.current_spool_id = null; });
      }
      slot.current_spool_id = item.spool_id || null;
    }
    if (printer._feed) printer._feed = { ...printer._feed, confirmed: true };
    save(); return { ok: true };
  }
  if (sub === "overview" && M === "GET") {
    moonrakerOnly();
    const setting = FEED_MODES.includes(printer.capabilities?.feed_mode) ? printer.capabilities.feed_mode : "auto";
    const direct = setting === "direct";
    const gates = direct ? [] : gatesFor(printer);
    const dryer = direct ? null : dryerRemaining(printer);
    const caps = { ...(printer.capabilities || {}), ...(gates.length ? { has_mmu: true, mmu_slots: gates.length } : {}), ...(dryer ? { has_dryer: true } : {}) };
    if (direct) {
      if (printer.capabilities?.has_mmu) caps.mmu_off = true;
      caps.has_mmu = false; caps.has_dryer = false; delete caps.mmu_slots;
    }
    caps.feed_mode = caps.has_mmu ? "mmu" : "direct";
    caps.feed_mode_setting = setting;
    if (caps.feed_mode === "direct" && hasHub(printer)) ensureHolder(printer);
    const mySlots = db.slots.filter((s) => s.printer_id === printer.id);
    const first = mySlots.find((s) => s.slot_index === HOLDER_INDEX)
      || mySlots.find((s) => s.slot_index === 1);
    const firstSpool = first?.current_spool_id ? db.spools.find((s) => s.id === first.current_spool_id) : null;
    // Подсветка камеры — как power-устройство Moonraker (у закрытых принтеров).
    const light = printer.capabilities?.has_chamber
      ? { device: "chamber_light", on: !!printer._light, locked: false }
      : null;
    caps.has_light = light !== null;
    observeFeed(printer, caps.feed_mode);
    const pending = printer._feed && !printer._feed.confirmed ? printer._feed : null;
    return {
      status: liveStatus(printer), gates, dryer, light, capabilities: caps,
      feed_change: pending
        ? {
            mode: pending.mode, prev: pending.prev, changed_at: pending.changed_at,
            mmu_name: caps.mmu_name,
            slots: db.slots
              .filter((s) => s.printer_id === printer.id && (pending.mode === "direct"
                ? s.id === first?.id
                : s.slot_index !== HOLDER_INDEX))
              .sort((a, b) => a.slot_index - b.slot_index)
              .map((s) => {
                const sp = s.current_spool_id ? db.spools.find((x) => x.id === s.current_spool_id) : null;
                return {
                  id: s.id, slot_index: s.slot_index, name: s.name,
                  spool: sp ? { id: sp.id, label: sp.label, material: sp.material, color_hex: sp.color_hex, color_name: sp.color_name, current_weight_g: sp.current_weight_g } : null,
                };
              }),
          }
        : null,
      direct_slot: caps.feed_mode === "direct" && first
        ? {
            id: first.id, slot_index: first.slot_index, name: first.name,
            spool: firstSpool
              ? {
                  id: firstSpool.id, label: firstSpool.label, material: firstSpool.material,
                  color_hex: firstSpool.color_hex, color_name: firstSpool.color_name,
                  current_weight_g: firstSpool.current_weight_g,
                }
              : null,
          }
        : null,
      totals: { total_jobs: 342, total_print_time_sec: 1180 * 3600, total_time_sec: 1260 * 3600, total_filament_mm: 4.65e6, longest_print_sec: 18.6 * 3600 },
      system: { klipper_version: "v0.12.0-rinkhals", hostname: "kobra-s1", moonraker_version: "0.9.3", os: "Rinkhals 2.1", cpu: "Cortex-A53 4×1.2GHz" },
    };
  }
  if (sub === "light" && M === "POST") {
    moonrakerOnly();
    if (!printer.capabilities?.has_chamber) throw new ApiError("У принтера нет управляемой подсветки", 422);
    printer._light = body.on != null ? !!body.on : !printer._light;
    save();
    return { ok: true, light: { device: "chamber_light", on: !!printer._light, locked: false } };
  }
  if (sub === "dryer" && M === "POST") {
    moonrakerOnly();
    const d = printer._dryer || (printer._dryer = { unit: 0, status: "stop", temp: 24, target_temp: 0, remaining_min: 0, duration_min: 0, humidity: 18 });
    if (body.action === "start") {
      if (!body.temp_c || !body.duration_min) throw new ApiError("Укажите температуру и время сушки", 422);
      d.status = "drying"; d.target_temp = body.temp_c; d.temp = body.temp_c; d.duration_min = body.duration_min;
      d.remaining_min = body.duration_min; d._startedAt = Date.now(); d.humidity = 22;
    } else if (body.action === "stop") {
      d.status = "stop"; d.target_temp = 0; d.remaining_min = 0; d.duration_min = 0; delete d._startedAt;
    } else throw new ApiError("Неизвестное действие", 422);
    save(); return { ok: true, dryer: dryerRemaining(printer) };
  }
  if (sub === "moonraker-jobs") {
    moonrakerOnly();
    if (parts[3] && parts[4] === "import" && M === "POST") {
      const jobId = decodeURIComponent(parts[3]);
      const raw = db.mrJobs.find((j) => j.job_id === jobId);
      if (!raw) throw notFound("Задание не найдено в истории Moonraker");
      const existing = db.printJobs.find((p) => p.source === "moonraker" && p.parsed_metadata?.moonraker_job_id === jobId);
      if (existing) return { print_job_id: existing.id, status: existing.status };
      const material = /_PETG_/i.test(raw.filename) ? "PETG" : "PLA";
      const pj = {
        id: uid(), printer_id: printer.id, source: "moonraker", file_name: raw.filename,
        slicer_name: raw.slicer, slicer_version: "2.1.1", estimated_print_time_sec: raw.print_duration_sec,
        filament_change_count: 0, total_filament_used_g: raw.filament_total_g, total_filament_used_mm: raw.filament_used_mm,
        status: "draft", created_at: nowIso(), completed_at: null, parsed_metadata: { moonraker_job_id: jobId },
        tools: [{ id: uid(), tool_index: 0, slot_index: 1, material, color_hex: null, used_g: raw.filament_total_g, used_mm: raw.filament_used_mm }],
        spool_usage: [],
      };
      db.printJobs.unshift(pj); save(); return { print_job_id: pj.id, status: pj.status };
    }
    if (M === "GET") {
      const limit = Number(query.limit) || 20;
      return annotateMrJobs(db.mrJobs.slice(0, limit));
    }
  }
  throw notFound("Принтер не найден");
}

function jobOut(pj) {
  const c = jobCost(pj);
  return {
    id: pj.id, printer_id: pj.printer_id, source: pj.source, file_name: pj.file_name, slicer_name: pj.slicer_name,
    slicer_version: pj.slicer_version, estimated_print_time_sec: pj.estimated_print_time_sec, filament_change_count: pj.filament_change_count,
    total_filament_used_g: pj.total_filament_used_g, total_filament_used_mm: pj.total_filament_used_mm, status: pj.status,
    created_at: pj.created_at, completed_at: pj.completed_at,
    cost: c ? Math.round(c.cost * 100) / 100 : null, cost_currency: c?.currency || null, cost_partial: c?.partial || false,
    failed: !!pj.parsed_metadata?.failed,
  };
}
function jobDetail(pj) {
  return { ...jobOut(pj), tools: pj.tools || [], spool_usage: pj.spool_usage || [] };
}
function printJobsRoute(M, parts, body) {
  if (parts.length === 1) {
    if (M === "GET") return [...db.printJobs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(jobOut);
    if (M === "POST") {
      const parsed = body.parsed || {};
      const pj = {
        id: uid(), printer_id: body.printer_id || null, source: "gcode", file_name: parsed.file_name || "print.gcode",
        slicer_name: parsed.slicer_name || null, slicer_version: parsed.slicer_version || null,
        estimated_print_time_sec: parsed.estimated_print_time_sec || null, filament_change_count: parsed.filament_change_count ?? null,
        total_filament_used_g: parsed.total_filament_used_g ?? null, total_filament_used_mm: parsed.total_filament_used_mm ?? null,
        status: "draft", created_at: nowIso(), completed_at: null, parsed_metadata: {},
        tools: (parsed.tools || []).map((t) => ({ id: uid(), tool_index: t.tool_index, slot_index: null, material: t.material || null, color_hex: t.color_hex || null, used_g: t.used_g ?? null, used_mm: t.used_mm ?? null })),
        spool_usage: [],
      };
      db.printJobs.unshift(pj); save(); return jobDetail(pj);
    }
  }
  const pj = db.printJobs.find((j) => j.id === parts[1]);
  if (!pj) throw notFound("Печать не найдена");
  const sub = parts[2];
  if (!sub && M === "GET") return jobDetail(pj);

  if (sub === "confirm-usage" && M === "POST") {
    const problems = [];
    const allowNeg = body.allow_negative || db.settings.allow_negative_consumption;
    const plan = [];
    for (const m of body.mappings || []) {
      const tool = (pj.tools || []).find((t) => t.tool_index === m.tool_index);
      if (!tool) continue;
      let sp = null;
      if (m.spool_id) sp = db.spools.find((s) => s.id === m.spool_id);
      else if (m.slot_id) { const sl = db.slots.find((s) => s.id === m.slot_id); sp = sl?.current_spool_id ? db.spools.find((s) => s.id === sl.current_spool_id) : null; }
      if (!sp) { problems.push({ tool_index: m.tool_index, detail: "Катушка не выбрана" }); continue; }
      let grams = Number(tool.used_g) || 0;
      if (grams <= 0 && Number(tool.used_mm) > 0) grams = gramsFromMm(tool.used_mm, sp.diameter_mm, sp.material);
      const available = Number(sp.current_weight_g);
      if (grams > available && !allowNeg) {
        problems.push({ tool_index: m.tool_index, detail: "Недостаточно филамента на катушке", needed_g: Math.round(grams * 10) / 10, available_g: Math.round(available * 10) / 10 });
        continue;
      }
      plan.push({ tool, sp, grams });
    }
    if (problems.length) throw new ApiError(problems, 409);
    pj.spool_usage = [];
    for (const { tool, sp, grams } of plan) {
      const before = Number(sp.current_weight_g);
      sp.current_weight_g = Math.max(allowNeg ? -1e9 : 0, before - grams);
      recompute(sp);
      addEvent(sp.id, { type: "print_usage", before, after: sp.current_weight_g, delta: -grams, reason: `Печать ${pj.file_name}` });
      pj.spool_usage.push({ id: uid(), spool_id: sp.id, printer_slot_id: null, tool_index: tool.tool_index, used_g: Math.round(grams * 100) / 100, confirmed_at: nowIso() });
    }
    pj.status = "consumed"; pj.completed_at = nowIso();
    // связать соответствующее mrJob как списанное
    const mrId = pj.parsed_metadata?.moonraker_job_id;
    if (mrId) { const mj = db.mrJobs.find((j) => j.job_id === mrId); if (mj) mj._consumed = pj.id; }
    save(); return jobDetail(pj);
  }
  if (sub === "cancel" && M === "POST") { pj.status = "cancelled"; save(); return jobOut(pj); }
  if (sub === "mark-failed" && M === "POST") {
    if (pj.status !== "consumed") throw new ApiError("Отметить браком можно только списанную печать", 409);
    pj.parsed_metadata = { ...(pj.parsed_metadata || {}), failed: body.failed }; save(); return jobDetail(pj);
  }
  throw notFound("Печать не найдена");
}

// ---------------------------------------------------------------------------
// Публичный API для client.js
// ---------------------------------------------------------------------------
export async function demoRequest(method, path, opts = {}) {
  await sleep(60 + Math.random() * 90);
  try {
    return dispatch(method, path, opts);
  } catch (e) {
    if (e instanceof ApiError) throw new Error(typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail));
    throw e;
  }
}

// Ответы-blob (этикетки/бэкап). Возвращает { blob, filename }.
export async function demoBlob(method, rawPath, opts = {}) {
  await sleep(60);
  load();
  const { path, query } = parse(rawPath);
  const parts = seg(path);

  if (path === "/api/backup/export") {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    return { blob, filename: "filament-backup.json" };
  }
  if (parts[0] === "spools") {
    // /api/spools/{id}/label.png|label.pdf  или  /api/spools/labels.pdf (POST)
    if (parts[1] === "labels.pdf") {
      const ids = (opts.body?.spool_ids || []).slice(0, 6);
      const first = db.spools.find((s) => ids.includes(s.id)) || db.spools[0];
      return { blob: new Blob([labelPdf(first)], { type: "application/pdf" }), filename: "labels-a4.pdf" };
    }
    const sp = db.spools.find((s) => s.id === parts[1]);
    if (sp) {
      const fields = (query.fields || "").split(",").filter(Boolean);
      if (parts[2] === "label.png") return { blob: new Blob([labelSvg(sp, fields)], { type: "image/svg+xml" }), filename: "label.svg" };
      if (parts[2] === "label.pdf") return { blob: new Blob([labelPdf(sp)], { type: "application/pdf" }), filename: `spool-${query.size || "classic"}.pdf` };
      if (parts[2] === "qr.png") return { blob: new Blob([fakeQr(sp.qr_token)], { type: "image/svg+xml" }), filename: "qr.svg" };
    }
  }
  // запасной вариант — пустой PDF
  return { blob: new Blob([labelPdf(db.spools[0])], { type: "application/pdf" }), filename: "file.pdf" };
}
