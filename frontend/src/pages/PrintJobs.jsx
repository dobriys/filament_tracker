import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, dateLocale } from "../i18n.js";

const STATUS = {
  draft: t("черновик"),
  ready_to_consume: t("готово к списанию"),
  consumed: t("списано"),
  cancelled: t("отменено"),
  error: t("ошибка"),
  archived: t("архив"),
};

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(dateLocale(), { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
}

const Swatch = ({ hex }) => (
  <span style={{ display: "inline-block", width: 13, height: 13, borderRadius: 3, background: hex || "#666", border: "1px solid var(--border)", verticalAlign: "middle", marginRight: 6 }} />
);

export default function PrintJobs() {
  const [jobs, setJobs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [spoolMap, setSpoolMap] = useState({});

  function load() {
    api.get("/api/print-jobs").then(setJobs).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get("/api/spools").then((ss) => setSpoolMap(Object.fromEntries(ss.map((s) => [s.id, s])))).catch(() => {});
  }, []);

  async function open(id) {
    setDetail(await api.get(`/api/print-jobs/${id}`));
  }
  async function cancel(id) {
    await api.post(`/api/print-jobs/${id}/cancel`);
    setDetail(null);
    load();
  }
  async function toggleFailed(job) {
    setDetail(await api.post(`/api/print-jobs/${job.id}/mark-failed`, { failed: !job.failed }));
    load();
  }

  return (
    <div>
      <h2>{t("История печати")}</h2>
      <div className="card">
        <table className="cards-mobile">
          <thead><tr><th>{t("Дата")}</th><th>{t("Файл")}</th><th>{t("Расход, г")}</th><th>{t("Цена")}</th><th>{t("Статус")}</th><th></th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td data-label={t("Дата")} className="muted" style={{ whiteSpace: "nowrap" }}>{fmtWhen(j.completed_at || j.created_at)}</td>
                <td data-label={t("Файл")} style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={j.file_name || ""}>
                  {(j.file_name || "—").split("/").pop()}
                  {j.slicer_name && <span className="muted" style={{ fontSize: 12 }}> · {j.slicer_name}</span>}
                </td>
                <td data-label={t("Расход, г")}>{j.total_filament_used_g != null ? Number(j.total_filament_used_g).toFixed(2) : "—"}</td>
                <td data-label={t("Цена")} title={j.cost_partial ? t("Часть катушек без цены — итог занижен") : undefined}>
                  {j.cost != null ? <>{fmtMoney(j.cost, j.cost_currency)}{j.cost_partial ? <span className="muted">*</span> : null}</> : "—"}
                </td>
                <td data-label={t("Статус")}>
                  <span className="badge">{STATUS[j.status] || j.status}</span>
                  {j.failed && <span className="badge empty" style={{ marginLeft: 6 }}>{t("брак")}</span>}
                </td>
                <td data-label=""><button className="secondary" onClick={() => open(j.id)}>{t("Открыть")}</button></td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={6} className="muted">{t("Печатей пока нет")}</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h3>{detail.file_name} — {STATUS[detail.status] || detail.status}</h3>
            <button className="secondary" onClick={() => setDetail(null)}>{t("Закрыть")}</button>
          </div>
          {detail.spool_usage.length > 0 && (
            <>
              <h4>{t("Фактическое списание")}</h4>
              <table>
                <thead><tr><th>{t("Катушка")}</th><th>{t("Списано, г")}</th><th>{t("Подтверждено")}</th></tr></thead>
                <tbody>
                  {detail.spool_usage.map((u) => {
                    const sp = spoolMap[u.spool_id];
                    return (
                      <tr key={u.id}>
                        <td>
                          {sp
                            ? <Link to={`/spools/${u.spool_id}`}><Swatch hex={sp.color_hex} />{sp.label || t("Без метки")}{sp.material ? <span className="muted"> · {sp.material}</span> : ""}</Link>
                            : <span className="muted">{t("катушка удалена (")}{String(u.spool_id).slice(0, 8)})</span>}
                        </td>
                        <td>{Number(u.used_g).toFixed(2)}</td>
                        <td>{u.confirmed_at ? new Date(u.confirmed_at).toLocaleString(dateLocale()) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {detail.cost != null && (
                <div style={{ marginTop: 10, fontWeight: 600 }}>
                  {t("Себестоимость печати:")} {fmtMoney(detail.cost, detail.cost_currency)}
                  {detail.cost_partial && <span className="muted" style={{ fontWeight: 400 }}> {t("(часть катушек без цены)")}</span>}
                </div>
              )}
            </>
          )}
          {detail.status === "consumed" && (
            <button
              className={detail.failed ? "secondary" : "danger"}
              style={{ marginTop: 12 }}
              onClick={() => toggleFailed(detail)}
            >
              {detail.failed ? t("✓ Брак — снять пометку") : t("Пометить как брак")}
            </button>
          )}
          {detail.status !== "consumed" && detail.status !== "cancelled" && (
            <button className="danger" style={{ marginTop: 12 }} onClick={() => cancel(detail.id)}>{t("Отменить печать")}</button>
          )}
        </div>
      )}
    </div>
  );
}
