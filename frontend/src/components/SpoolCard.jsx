import { t } from "../i18n.js";
export default function SpoolCard({ data }) {
  if (!data) return null;
  const title = [data.brand, data.name].filter(Boolean).join(" ") || data.label;
  const rows = [
    [t("Материал"), data.material || "—"],
    [t("Цвет"), [data.color_name, data.color_hex].filter(Boolean).join(" ") || "—"],
    [t("Сопло"), data.nozzle_temp || "—"],
    [t("Стол"), data.bed_temp || "—"],
    ["Диаметр", data.diameter_mm ? `${data.diameter_mm} ${t("мм")}` : "—"],
    ["Плотность", data.density_g_cm3 ? `${data.density_g_cm3} ${t("г/см³")}` : "—"],
    ["Остаток", `${Number(data.remaining_g).toFixed(0)} ${t("г")}`],
    [t("Хранение"), data.location_name || "—"],
    [t("Открыта"), data.opened_date || "—"],
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        maxWidth: 460,
        background: "var(--panel)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          {data.color_hex && (
            <span style={{ width: 14, height: 14, borderRadius: 4, background: data.color_hex, display: "inline-block", border: "1px solid var(--border)" }} />
          )}
          {title}
        </div>
        <table style={{ fontSize: 13 }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: "var(--muted)", padding: "2px 8px 2px 0", border: "none" }}>{k}</td>
                <td style={{ padding: "2px 0", border: "none" }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.qr_png_base64 && (
        <img src={data.qr_png_base64} alt="QR" width={110} height={110} style={{ alignSelf: "flex-start", background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }} />
      )}
    </div>
  );
}
