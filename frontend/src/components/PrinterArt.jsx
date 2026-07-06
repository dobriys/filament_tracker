import { useState } from "react";
import { t } from "../i18n.js";

// Slug принтера для файла иллюстрации: тот же формат, что и key пресета на
// бэке (printer_presets._preset). Свой SVG для модели кладётся в
// public/icons/printers/<slug>.svg — например anycubic-kobra-s1-combo.svg.
// Если файла нет, показываем сгенерированный силуэт (заглушку).
export function printerSlug(brand, model) {
  const s = `${brand || ""} ${model || ""}`
    .toLowerCase()
    .replace(/\//g, " ")
    .replace(/\+/g, "plus")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-");
  return s || null;
}

// Цвет бренда для акцентов карточки/иллюстрации. Неизвестный бренд → акцент темы.
const BRAND_ACCENT = {
  anycubic: "#12b886",
  bambu: "#00ae42",
  "bambu lab": "#00ae42",
  prusa: "#fa6831",
  "prusa research": "#fa6831",
  creality: "#0aa1e0",
  elegoo: "#e8412b",
  voron: "#e4002b",
  qidi: "#f5a623",
  flashforge: "#f5a623",
};

export function brandAccent(brand) {
  return BRAND_ACCENT[(brand || "").trim().toLowerCase()] || "var(--accent)";
}

// Силуэт FDM-принтера, тонированный цветом бренда. Меняется по возможностям:
// камера (has_chamber) — корпус вокруг, мультиподача (has_mmu) — внешний бокс со слотами.
export function PrinterArt({ caps = {}, brand, model, size = 92 }) {
  const accent = brandAccent(brand);
  const slug = printerSlug(brand, model);
  // Запоминаем именно слаг, для которого файла не нашлось: при смене модели
  // (например, в форме добавления принтера) картинка пробуется заново.
  const [failedSlug, setFailedSlug] = useState(null);

  // Есть готовая иллюстрация под эту модель — показываем её вместо силуэта.
  // onError (нет файла) → откатываемся на сгенерированный силуэт.
  if (slug && failedSlug !== slug) {
    return (
      <img
        src={`/icons/printers/${slug}.svg`}
        width={size}
        height={size}
        alt={t("Иллюстрация принтера")}
        onError={() => setFailedSlug(slug)}
        style={{ flex: "0 0 auto", objectFit: "contain" }}
      />
    );
  }

  const enclosed = !!caps.has_chamber;
  const n = caps.has_mmu ? Math.max(1, Math.min(6, caps.mmu_slots || 4)) : 0;

  const slots = [];
  if (n > 0) {
    const top = 36;
    const step = Math.min(10, 46 / n);
    for (let i = 0; i < n; i++) {
      slots.push(
        <rect key={i} x="98" y={top + i * step} width="18" height={Math.max(4, step - 3)} rx="2"
          fill={accent} fillOpacity="0.55" />
      );
    }
  }

  return (
    <svg width={size} height={(size * 104) / 132} viewBox="0 0 132 104" fill="none"
      role="img" aria-label={t("Иллюстрация принтера")} style={{ flex: "0 0 auto" }}>
      {enclosed && (
        <rect x="12" y="12" width="80" height="82" rx="11"
          fill={accent} fillOpacity="0.06" stroke={accent} strokeOpacity="0.45" strokeWidth="2" />
      )}
      <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
        opacity="0.85">
        <path d="M28 28 H76" />
        <path d="M31 28 V80" />
        <path d="M73 28 V80" />
        <path d="M24 80 H80" />
        <path d="M30 80 V85" />
        <path d="M74 80 V85" />
        <path d="M31 40 H73" />
        <path d="M28 66 H76" />
      </g>
      <rect x="34" y="62" width="36" height="4.5" rx="2" fill="currentColor" opacity="0.8" />
      <rect x="46" y="36" width="12" height="9" rx="2" fill={accent} />
      <path d="M52 45 v4" stroke={accent} strokeWidth="3" strokeLinecap="round" />
      {n > 0 && (
        <>
          <path d="M76 33 H92" stroke={accent} strokeWidth="2" strokeLinecap="round" />
          <rect x="92" y="28" width="30" height="56" rx="6"
            fill={accent} fillOpacity="0.06" stroke={accent} strokeWidth="2" />
          {slots}
        </>
      )}
    </svg>
  );
}

// Значки возможностей принтера — компактная сводка «что умеет».
export function CapabilityChips({ caps = {} }) {
  const chips = [];
  if (caps.has_mmu) chips.push(["🎛", `${caps.mmu_name || t("Мультиподача")}${caps.mmu_slots ? ` ×${caps.mmu_slots}` : ""}`]);
  if (caps.has_dryer) chips.push(["🔥", t("Сушилка")]);
  if (caps.has_chamber) chips.push(["📦", t("Камера")]);
  if (chips.length === 0) return null;
  return (
    <div className="cap-chips">
      {chips.map(([icon, label]) => (
        <span key={label} className="cap-chip"><span aria-hidden="true">{icon}</span> {label}</span>
      ))}
    </div>
  );
}
