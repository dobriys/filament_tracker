import { t } from "./i18n.js";

// Единая схема расширенных характеристик филамента (как на 3dfilamentprofiles.com).
// Используется и в форме (ввод), и на странице катушки (вывод).

// Общий список материалов (профили, катушки, фильтр инвентаря).
export const MATERIALS = [
  "PLA", "PLA+/Pro", "PETG", "PETG+", "ABS", "ABS+", "ASA", "TPU",
  "PA (Nylon)", "PC", "PCTG", "HIPS", "PVA",
];

// Полный набор AMS-систем Bambu Lab (как на сайте).
export const AMS_OPTIONS = ["AMS Lite (L)", "AMS (A)", "AMS 2 Pro (A2)", "AMS HT (HT)"];
// Build plates: подтверждённые на сайте + стандартные Bambu/общие.
export const BUILD_PLATE_OPTIONS = [
  "Cool Plate", "Cool Plate SuperTack", "Smooth PEI", "Textured PEI",
  "Engineering Plate", "Garolite", "Glass",
];

export const SPEC_GROUPS = [
  {
    title: t("Технические характеристики"),
    fields: [
      { key: "material_type", label: t("Тип материала"), placeholder: "Basic / Pro / Silk…", type: "text" },
      { key: "density", label: t("Плотность"), unit: t("г/см³"), type: "number" },
      { key: "softening_temp", label: t("Темп. размягчения"), unit: "°C", type: "number" },
      { key: "chamber_temp", label: t("Темп. камеры"), unit: "°C", type: "number" },
      { key: "shrinkage", label: t("Усадка"), unit: "%", type: "number" },
    ],
  },
  {
    title: t("Температуры"),
    fields: [
      { key: "nozzle_min", label: t("Сопло min"), unit: "°C", type: "number" },
      { key: "nozzle_max", label: t("Сопло max"), unit: "°C", type: "number" },
      { key: "bed_min", label: t("Стол min"), unit: "°C", type: "number" },
      { key: "bed_max", label: t("Стол max"), unit: "°C", type: "number" },
      { key: "fan_min", label: t("Обдув min"), unit: "%", type: "number" },
      { key: "fan_max", label: t("Обдув max"), unit: "%", type: "number" },
      { key: "bridge_fan", label: t("Обдув мостов"), unit: "%", type: "number" },
      { key: "fan_disable_layers", label: t("Отключить обдув на слоях"), placeholder: "0-1", type: "text" },
    ],
  },
  {
    title: t("Скорости печати"),
    fields: [
      { key: "fl_wall_speed", label: t("1-й слой: стенки"), unit: t("мм/с"), type: "number" },
      { key: "fl_infill_speed", label: t("1-й слой: заполнение"), unit: t("мм/с"), type: "number" },
      { key: "outer_wall_speed", label: t("Внешняя стенка"), unit: t("мм/с"), type: "number" },
      { key: "top_surface_speed", label: t("Верхняя поверхность"), unit: t("мм/с"), type: "number" },
      { key: "ironing_flow", label: "Ironing Flow", unit: "%", type: "number" },
      { key: "ironing_speed", label: "Ironing Speed", unit: t("мм/с"), type: "number" },
    ],
  },
  {
    title: t("Поток, сушка, TD"),
    fields: [
      { key: "max_volumetric_speed", label: t("Макс. объёмная скорость"), unit: t("мм³/с"), type: "number" },
      { key: "flow_ratio", label: "Flow Ratio", type: "number" },
      { key: "drying_temp", label: t("Темп. сушки"), unit: "°C", type: "number" },
      { key: "dry_time_hours", label: t("Время сушки"), unit: t("ч"), type: "number" },
      { key: "td", label: "Transmission Distance (TD)", type: "number" },
    ],
  },
  {
    title: t("Совместимость и продукт"),
    fields: [
      { key: "ams_compatibility", label: t("AMS-совместимость"), type: "multiselect", options: AMS_OPTIONS },
      { key: "build_plates", label: t("Столы (build plates)"), type: "multiselect", options: BUILD_PLATE_OPTIONS },
      { key: "gtin", label: "GTIN / EAN / UPC", type: "text" },
      { key: "datasheet_url", label: t("Data Sheet (ссылка)"), type: "text" },
      { key: "product_url", label: t("Ссылка на продукт"), type: "text" },
    ],
  },
];

export const SPEC_FIELDS = SPEC_GROUPS.flatMap((g) => g.fields);

// Ключи specs, которые у профиля являются отдельными колонками (не дублируем в JSON).
export const PROFILE_COLUMN_SPEC_KEYS = [
  "nozzle_min", "nozzle_max", "bed_min", "bed_max",
  "density", "flow_ratio", "max_volumetric_speed", "pressure_advance",
];

// Группы specs для профиля — без полей, что хранятся колонками.
export function profileSpecGroups() {
  return SPEC_GROUPS
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !PROFILE_COLUMN_SPEC_KEYS.includes(f.key)) }))
    .filter((g) => g.fields.length);
}

export function fmtSpec(field, value) {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  return field.unit ? `${value} ${field.unit}` : String(value);
}
