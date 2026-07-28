// Помощники по катушкам: как показать катушку человеку одинаково во всех местах.
import { t } from "../i18n.js";
import { locationPath } from "./locations.js";

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
    low: s.status === "almost_empty" || s.status === "empty" || pct < 0.15,
  };
}
