import { t } from "../i18n.js";

// Вердикты сверки «что видит принтер» ↔ «что привязано в приложении»
const VERDICT = {
  match: { icon: "✓", cls: "ok", label: () => t("Совпадает") },
  mismatch: { icon: "⚠", cls: "warn", label: () => t("Не совпадает с катушкой") },
  unassigned: { icon: "＋", cls: "hint", label: () => t("Катушка не привязана") },
  empty: { icon: "—", cls: "dim", label: () => t("Слот пуст") },
};

const Dot = ({ hex, size = 14 }) => (
  <span
    style={{
      display: "inline-block",
      width: size,
      height: size,
      borderRadius: "50%",
      background: hex || "var(--border)",
      border: "1px solid var(--border)",
      verticalAlign: "middle",
      flexShrink: 0,
    }}
  />
);

// Полная карточка гейта — для панели Moonraker на /printers
export function GateCard({ g }) {
  const v = VERDICT[g.verdict] || VERDICT.empty;
  return (
    <div className={`gate-card gate-${v.cls}`} title={v.label()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>{t("Слот")} {g.slot_index}</span>
        <span className={`gate-verdict ${v.cls}`}>{v.icon}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <Dot hex={g.occupied ? g.color_hex : null} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {g.occupied ? (g.material || "—") : t("пусто")}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        {g.spool ? (
          <>
            <Dot hex={g.spool.color_hex} size={10} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {g.spool.color_name || g.spool.label || t("Без метки")}
            </span>
          </>
        ) : (
          <span>{v.label()}</span>
        )}
      </div>
    </div>
  );
}

// Плитки гейтов — для карточки принтера на главной (стиль макета)
export function GateChips({ gates }) {
  if (!gates?.length) return null;
  return (
    <div className="gate-tiles">
      {gates.map((g) => {
        const v = VERDICT[g.verdict] || VERDICT.empty;
        return (
          <div key={g.gate} className={`gate-tile gate-${v.cls}`} title={`${t("Слот")} ${g.slot_index}: ${g.occupied ? g.material || "" : t("пусто")} · ${v.label()}`}>
            <span className={`gate-verdict ${v.cls}`}>{v.icon}</span>
            <div className="gate-tile-swatch" style={{ background: g.occupied ? g.color_hex : "var(--panel-2)" }} />
            <div className="gate-tile-cap">{g.slot_index}: {g.occupied ? (g.material || "—") : t("пусто")}</div>
          </div>
        );
      })}
    </div>
  );
}
