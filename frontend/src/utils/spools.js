// Помощники по катушкам: как показать катушку человеку одинаково во всех местах.
import { t } from "../i18n.js";
import { locationPath } from "./locations.js";

// Порог «катушка заканчивается» — доля от ёмкости самой катушки, подрезанная
// с двух сторон (см. backend/app/services/settings_service.py):
//
//   порог = min(max(ёмкость × pct, min_g), max_g)
//
// Одним числом в граммах не обойтись: 100 г на пробнике 250 г — это 40 %, а на
// бухте 3 кг — 3 %. Чистая доля тоже не годится: 10 % от 5 кг — полкило, то есть
// ещё полсуток печати.
//
// Конфиг держим модульной переменной, а не прокидываем параметром: enrichSpool
// зовут из десятка мест, и таскать его через каждое — шум. Обновляется один раз
// при входе (App.jsx) и после сохранения настроек.
export const LOW_DEFAULTS = { pct: 10, min_g: 50, max_g: 200 };
// Катушка без указанной ёмкости считается килограммовой — стандарт настольной
// печати, на нём правило даёт привычные 100 г.
export const DEFAULT_CAPACITY_G = 1000;

let lowCfg = { ...LOW_DEFAULTS };

export function setLowConfig(cfg) {
  if (!cfg) return;
  const next = {
    pct: Number(cfg.spool_low_pct ?? cfg.pct),
    min_g: Number(cfg.spool_low_min_g ?? cfg.min_g),
    max_g: Number(cfg.spool_low_max_g ?? cfg.max_g),
  };
  if (Number.isFinite(next.pct) && next.min_g > 0 && next.max_g > 0) lowCfg = next;
}

export function lowThresholdFor(capacityG, cfg = lowCfg) {
  const capacity = Number(capacityG) || DEFAULT_CAPACITY_G;
  let lo = Number(cfg.min_g) || 0;
  let hi = Number(cfg.max_g) || 0;
  if (hi < lo) [lo, hi] = [hi, lo]; // перепутанные зажимы не схлопывают порог
  return Math.min(Math.max((capacity * (Number(cfg.pct) || 0)) / 100, lo), hi);
}

// Заголовок без дублирования бренда (если название уже начинается с бренда).
export function spoolTitle(brand, name) {
  if (name && brand && name.toLowerCase().startsWith(brand.toLowerCase())) return name;
  return [brand, name].filter(Boolean).join(" ") || t("Без метки");
}

// Свести катушку и её профиль пластика в поля для показа: у катушки материал,
// цвет и диаметр могут быть пустыми — тогда берём их из профиля.
export function enrichSpool(s, { profiles = [], locations = [] } = {}) {
  const p = profiles.find((x) => x.id === s.filament_profile_id);
  const remaining = Number(s.current_weight_g) || 0;
  const capacity = Number(s.initial_filament_weight_g) || 1000;
  const pct = Math.max(0, Math.min(1, remaining / capacity));
  return {
    title: spoolTitle(s.manufacturer || p?.brand, p?.name || s.label),
    sku: s.sku || s.label || "",
    material: s.material || p?.material || "",
    colorName: s.color_name || p?.color_name || "",
    colorHex: s.color_hex || p?.color_hex || "",
    diameter: s.diameter_mm || p?.diameter_mm || null,
    locName: s.location_id && locations.length ? locationPath(locations, s.location_id) : "",
    // Короткое имя места («Полка у стола») — для строк, где полный путь не влезает.
    locLeaf: s.location_id && locations.length
      ? locations.find((l) => l.id === s.location_id)?.name || "" : "",
    remaining,
    pct,
    // Порог считается от ёмкости этой самой катушки — тем же правилом, что и
    // статус на сервере, иначе подсветка и статус снова разъедутся.
    low: s.status === "empty" || remaining <= lowThresholdFor(capacity),
  };
}
