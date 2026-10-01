import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import SpoolPicker from "./SpoolPicker.jsx";
import { slotLabel } from "../utils/slots.js";

// Вердикты сверки «что видит принтер» ↔ «что привязано в приложении»
const VERDICT = {
  match: { icon: "✓", cls: "ok", label: () => t("Совпадает") },
  color_diff: { icon: "≈", cls: "hint", label: () => t("Материал совпадает, оттенок отличается") },
  mismatch: { icon: "!", cls: "warn", label: () => t("Не совпадает с катушкой") },
  unassigned: { icon: "+", cls: "hint", label: () => t("Катушка не привязана") },
  empty: { icon: "—", cls: "dim", label: () => t("Слот пуст") },
};

// Подпись вердикта. «Слот пуст, а катушка числится» общая фраза «не совпадает»
// объясняет плохо — тут надо прямо сказать, что катушку забыли снять.
function verdictNote(g) {
  if (g.verdict === "mismatch" && !g.occupied) {
    return t("Слот пуст, а катушка всё ещё привязана");
  }
  return (VERDICT[g.verdict] || VERDICT.empty).label();
}

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

// Плитки гейтов — для карточки принтера на главной (стиль макета).
// С onSelect плитка кликабельна: по ней открывается GateEditor.
export function GateChips({ gates, selected = null, onSelect }) {
  if (!gates?.length) return null;
  return (
    <div className="gate-tiles">
      {gates.map((g) => {
        const v = VERDICT[g.verdict] || VERDICT.empty;
        const isSel = selected === g.gate;
        const hint = `${t("Слот")} ${g.slot_index}: ${g.occupied ? g.material || "" : t("пусто")} · ${verdictNote(g)}`;
        const pick = onSelect
          ? {
              role: "button",
              tabIndex: 0,
              "aria-pressed": isSel,
              onClick: () => onSelect(g.gate),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.gate); }
              },
            }
          : {};
        return (
          <div
            key={g.gate}
            className={`gate-tile gate-${v.cls}${onSelect ? " pickable" : ""}${isSel ? " selected" : ""}`}
            title={onSelect ? `${hint} · ${t("нажмите, чтобы привязать или снять катушку")}` : hint}
            {...pick}
          >
            <span className={`gate-verdict ${v.cls}`}>{v.icon}</span>
            <div className="gate-tile-swatch" style={{ background: g.occupied ? g.color_hex : "var(--panel-2)" }} />
            <div className="gate-tile-cap">{g.slot_index}: {g.occupied ? (g.material || "—") : t("пусто")}</div>
          </div>
        );
      })}
    </div>
  );
}

// Привязка и снятие катушки прямо под плитками слотов — чтобы не ходить в
// «Мои катушки» и в карточку самой катушки. Справочники (катушки, профили,
// места, занятость слотов) тянем сами и только при открытии: на главной это
// нужно раз в несколько дней, а плитки живут на каждой загрузке.
export function GateEditor({ printer, gate: g, onChanged, onClose }) {
  const [spools, setSpools] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [occupied, setOccupied] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    api.get("/api/spools")
      .then((r) => alive && setSpools(r))
      .catch((e) => { if (alive) { setSpools([]); setErr(String(e.message || e)); } });
    api.get("/api/filament-profiles").then((r) => alive && setProfiles(r)).catch(() => {});
    api.get("/api/locations").then((r) => alive && setLocations(r)).catch(() => {});
    // Занятость по всем принтерам: в списке видно, что катушка уже стоит в
    // другом слоте (привязка её оттуда заберёт).
    (async () => {
      const printers = await api.get("/api/printers").catch(() => []);
      const map = {};
      for (const p of printers) {
        const ss = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        for (const s of ss) {
          if (!s.current_spool_id) continue;
          const name = slotLabel(s);
          map[s.current_spool_id] = p.id === printer.id ? name : `${p.name} / ${name}`;
        }
      }
      if (alive) setOccupied(map);
    })();
    return () => { alive = false; };
  }, [printer.id]);

  // Ошибка относится к слоту, на котором случилась, — на соседнем не тянем её.
  useEffect(() => { setErr(""); }, [g.gate]);

  async function run(action) {
    setBusy(true);
    setErr("");
    try {
      await action();
      await onChanged?.();
      // Итог виден по самой плитке (значок вердикта), так что закрываем
      // редактор — иначе каждое действие требовало бы ещё и клика «закрыть».
      onClose?.();
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  }

  // Записи слота может не быть (хаб больше, чем заведено слотов): ищем её по
  // номеру заново, а не берём из устаревшей сводки, и только потом создаём.
  async function slotIdFor() {
    if (g.slot_id) return g.slot_id;
    const list = await api.get(`/api/printers/${printer.id}/slots`);
    const found = list.find((s) => s.slot_index === g.slot_index);
    if (found) return found.id;
    const created = await api.post(`/api/printers/${printer.id}/slots`, { slot_index: g.slot_index });
    return created.id;
  }

  const bind = (spoolId) =>
    spoolId && run(async () => {
      const slotId = await slotIdFor();
      await api.post(`/api/slots/${slotId}/assign-spool`, { spool_id: spoolId });
    });
  const unbind = () =>
    run(() => api.post(`/api/slots/${g.slot_id}/unassign-spool`));

  const v = VERDICT[g.verdict] || VERDICT.empty;
  const bound = g.spool;
  const grams = bound ? spools?.find((x) => x.id === bound.id)?.current_weight_g : null;
  // Забыли снять катушку из пустого слота — это единственное, что тут надо сделать.
  const forgotten = g.verdict === "mismatch" && !g.occupied;

  return (
    <div className="gate-editor">
      <div className="gate-editor-head">
        <b>{t("Слот")} {g.slot_index}</b>
        <span className={`gate-editor-note ${v.cls}`}>
          <span className={`gate-verdict ${v.cls}`}>{v.icon}</span> {verdictNote(g)}
        </span>
        <button className="secondary gate-editor-close" onClick={onClose} title={t("Закрыть")} aria-label={t("Закрыть")}>×</button>
      </div>

      <div className="gate-editor-rows">
        <span className="muted">{t("Принтер видит")}</span>
        <span className="gate-editor-val">
          <Dot hex={g.occupied ? g.color_hex : null} size={12} />
          {g.occupied ? (g.material || "—") : t("пусто")}
        </span>

        <span className="muted">{t("Привязана")}</span>
        <span className="gate-editor-val">
          {bound ? (
            <>
              <Dot hex={bound.color_hex} size={12} />
              <span className="gate-editor-spool">
                {[bound.color_name || bound.label || t("Без метки"), bound.material].filter(Boolean).join(" · ")}
                {grams != null ? ` · ${Math.round(grams)} ${t("г")}` : ""}
              </span>
              <button
                className={forgotten ? "" : "secondary"}
                disabled={busy}
                onClick={unbind}
              >
                {t("Снять")}
              </button>
            </>
          ) : (
            <span className="muted">{t("нет")}</span>
          )}
        </span>
      </div>

      <SpoolPicker
        spools={spools || []}
        profiles={profiles}
        locations={locations}
        occupied={occupied}
        preferMaterial={g.occupied ? g.material : ""}
        disabled={busy || spools === null}
        placeholder={bound ? t("— заменить катушку —") : t("— привязать катушку —")}
        onSelect={(id) => id !== bound?.id && bind(id)}
      />
      {err && <div className="error">{err}</div>}
    </div>
  );
}
