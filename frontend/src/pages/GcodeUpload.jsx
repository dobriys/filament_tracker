import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { t } from "../i18n.js";

function fmtTime(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h ? h + t("ч") + " " : ""}${m}${t("м")}`;
}
const Swatch = ({ hex }) => (
  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: hex || "#666", border: "1px solid var(--border)", marginRight: 6, verticalAlign: "middle" }} />
);

export default function GcodeUpload() {
  const [printers, setPrinters] = useState([]);
  const [printerId, setPrinterId] = useState("");
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/printers").then(setPrinters).catch(() => {});
  }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setParsed(null); setBusy(true);
    try {
      setParsed(await api.postFile("/api/gcode/parse", file));
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function createAndConsume() {
    setError(null);
    try {
      const j = await api.post("/api/print-jobs", { printer_id: printerId || null, parsed });
      navigate(`/print-jobs/${j.id}/consume`);
    } catch (err) { setError(err.message); }
  }

  return (
    <div>
      <h2>{t("Загрузка gcode")}</h2>

      <div className="card">
        <div className="row">
          <div>
            <label>{t("Принтер (необязательно — подставит катушки из слотов)")}</label>
            <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">{t("— без привязки —")}</option>
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label>{t("Файл .gcode / .bgcode")}</label>
            <input type="file" accept=".gcode,.bgcode,.g,.gco" onChange={onFile} />
          </div>
        </div>
        {busy && <div className="muted">{t("Обработка…")}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      {parsed && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <div><span className="muted">{t("Слайсер:")}</span> {parsed.slicer_name || "?"} {parsed.slicer_version || ""}</div>
            <div><span className="muted">{t("Время:")}</span> {fmtTime(parsed.estimated_print_time_sec)}</div>
            <div><span className="muted">{t("Смен филамента:")}</span> {parsed.filament_change_count ?? "—"}</div>
            <div><span className="muted">{t("Итого:")}</span> {parsed.total_filament_used_g?.toFixed(2)}{" "}{t("г")}</div>
          </div>
          <table style={{ marginTop: 4 }}>
            <thead><tr><th>{t("Инструмент")}</th><th>{t("Материал")}</th><th>{t("Цвет")}</th><th>{t("Расход, г")}</th><th>{t("Расход, мм")}</th></tr></thead>
            <tbody>
              {parsed.tools.map((t) => (
                <tr key={t.tool_index}>
                  <td>Tool {t.tool_index}</td>
                  <td>{t.material || "—"}</td>
                  <td>{t.color_hex && <Swatch hex={t.color_hex} />}{t.color_hex || ""}</td>
                  <td>{t.used_g != null ? t.used_g.toFixed(2) : "—"}</td>
                  <td>{t.used_mm != null ? t.used_mm.toFixed(0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={{ marginTop: 12 }} onClick={createAndConsume}>{t("Создать печать и списать →")}</button>
        </div>
      )}
    </div>
  );
}
