import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { t, tServer } from "../i18n.js";

const Swatch = ({ hex, size = 13 }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: 3, background: hex || "#666", border: "1px solid var(--border)", verticalAlign: "middle" }} />
);

// Списание печати: сопоставление Tool → катушка из инвентаря и подтверждение.
export default function ConsumeJob() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [spools, setSpools] = useState([]);
  const [slotMap, setSlotMap] = useState({});
  const [mapping, setMapping] = useState({});
  const [allowNegative, setAllowNegative] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/spools").then(setSpools).catch(() => {});
    api.get(`/api/print-jobs/${id}`).then(async (j) => {
      setJob(j);
      if (j.status === "consumed") { setResult(j); return; }
      const printers = await api.get("/api/printers").catch(() => []);
      const sm = {};
      const slotByIndex = {};
      for (const p of printers) {
        const slots = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        for (const s of slots) {
          if (s.current_spool_id) sm[s.current_spool_id] = `${p.name} / ${s.name || "Slot " + s.slot_index}`;
          if (p.id === j.printer_id && s.current_spool_id) slotByIndex[s.slot_index] = s.current_spool_id;
        }
      }
      setSlotMap(sm);
      const init = {};
      (j.tools || []).forEach((tool) => {
        if (Number(tool.used_g) > 0 && slotByIndex[tool.tool_index + 1]) init[tool.tool_index] = slotByIndex[tool.tool_index + 1];
      });
      setMapping(init);
    }).catch(() => {});
  }, [id]);

  const spoolById = (sid) => spools.find((s) => s.id === sid);

  async function confirm() {
    setError(null); setProblems(null); setBusy(true);
    try {
      const mappings = job.tools
        .filter((tool) => Number(tool.used_g) > 0 && mapping[tool.tool_index])
        .map((tool) => ({ tool_index: tool.tool_index, spool_id: mapping[tool.tool_index] }));
      const res = await api.post(`/api/print-jobs/${id}/confirm-usage`, { mappings, allow_negative: allowNegative });
      setResult(res);
    } catch (err) {
      try {
        const e = JSON.parse(err.message);
        if (Array.isArray(e)) setProblems(e); else setError(err.message);
      } catch { setError(err.message); }
    }
    setBusy(false);
  }

  if (!job) return <div>{t("Загрузка…")}</div>;

  if (result) {
    return (
      <div>
        <Link to="/print-jobs">{t("← История печати")}</Link>
        <div className="card" style={{ borderColor: "var(--ok)", marginTop: 8 }}>
          <h3>{t("✓ Списано —")}{" "}{result.file_name}</h3>
          <table>
            <thead><tr><th>{t("Катушка")}</th><th>{t("Списано, г")}</th></tr></thead>
            <tbody>
              {result.spool_usage.map((u) => {
                const sp = spoolById(u.spool_id);
                return <tr key={u.id}><td>{sp ? <Link to={`/spools/${u.spool_id}`}><Swatch hex={sp.color_hex} /> {sp.label || t("Без метки")}</Link> : u.spool_id?.slice(0, 8)}</td><td>{Number(u.used_g).toFixed(2)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/print-jobs">{t("← История печати")}</Link>
      <h2 style={{ margin: "6px 0 4px" }}>{t("Списание печати")}</h2>
      <div className="muted" style={{ marginBottom: 16 }}>
        {job.file_name} · {job.slicer_name || "?"}{" "}{t("· всего")}{" "}{job.total_filament_used_g != null ? Number(job.total_filament_used_g).toFixed(2) : "—"} {t("г")}
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <h3 className="card-title">{t("Какой катушкой печатался каждый инструмент")}</h3>
        <div className="card-sub">{t("Слева — что в печати, справа — катушка из инвентаря.")}</div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>{t("Инструмент")}</th><th>{t("Расход")}</th><th style={{ width: 30, textAlign: "center" }}>→</th><th>{t("Катушка из инвентаря")}</th></tr></thead>
          <tbody>
            {job.tools.map((tool) => {
              const unused = Number(tool.used_g) <= 0;
              const sp = spoolById(mapping[tool.tool_index]);
              return (
                <tr key={tool.id}>
                  <td>
                    <strong>Tool {tool.tool_index}</strong>
                    <div className="muted" style={{ fontSize: 13 }}><Swatch hex={tool.color_hex} /> {tool.material || "—"} {tool.color_hex || ""}</div>
                  </td>
                  <td>{unused ? <span className="muted">{t("не используется")}</span> : `${Number(tool.used_g).toFixed(2)} ${t("г")}`}</td>
                  <td style={{ textAlign: "center", color: "var(--muted)" }}>→</td>
                  <td>
                    <select value={mapping[tool.tool_index] || ""} disabled={unused} style={{ minWidth: 280 }}
                      onChange={(e) => setMapping({ ...mapping, [tool.tool_index]: e.target.value })}>
                      <option value="">{unused ? "—" : t("— выбрать катушку —")}</option>
                      {spools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {(s.label || t("Без метки"))}{s.material ? ` · ${s.material}` : ""}{s.color_name ? ` · ${s.color_name}` : ""} · {Number(s.current_weight_g).toFixed(0)} {t("г")}{slotMap[s.id] ? ` · [${slotMap[s.id]}]` : ""}
                        </option>
                      ))}
                    </select>
                    {sp && (
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <Swatch hex={sp.color_hex} size={16} />
                        <strong>{sp.label || t("Без метки")}</strong>
                        <span className="muted">{[sp.material, sp.color_name].filter(Boolean).join(" · ")}</span>
                        <span className="muted">· {Number(sp.current_weight_g).toFixed(0)}{" "}{t("г")}</span>
                        {slotMap[sp.id] && <span className="badge in_use">{slotMap[sp.id]}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />
          {t("Разрешить списание в минус (если не хватает остатка)")}
        </label>
        <button style={{ marginTop: 12 }} onClick={confirm} disabled={busy}>{t("Подтвердить списание")}</button>

        {problems && (
          <div className="card" style={{ marginTop: 12, borderColor: "var(--danger)" }}>
            <strong>{t("Нельзя списать:")}</strong>
            {problems.map((p, i) => (
              <div key={i} className="error">
                {p.tool_index != null ? `Tool ${p.tool_index}: ` : ""}{tServer(p.detail)}
                {p.needed_g != null && ` ${t("(нужно")} ${p.needed_g} ${t("г, есть")} ${p.available_g} ${t("г)")}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
