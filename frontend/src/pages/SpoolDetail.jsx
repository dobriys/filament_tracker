import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { SPEC_GROUPS, fmtSpec } from "../specFields.js";
import { spoolTitle } from "./Spools.jsx";
import { t, dateLocale, tReason } from "../i18n.js";
import Icon from "../components/Icon.jsx";

const STATUS_RU = {
  new: t("Новая"), in_use: t("Используется"), almost_empty: t("Заканчивается"),
  empty: t("Закончилась"), archived: t("Архив"),
};
const EVENT_RU = {
  created: t("Создана"), manual_adjustment: t("Корректировка"), weighed: t("Взвешивание"),
  print_usage: t("Печать"), moved: t("Перемещение"), archived: t("Архив"),
  dried: t("Сушка"),
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", year: "2-digit" });
}
function lengthM(grams, density, dmm) {
  if (!grams) return 0;
  const r = (Number(dmm) || 1.75) / 2 / 10; // cm
  const area = Math.PI * r * r; // cm²
  return Number(grams) / (Number(density) || 1.24) / area / 100; // m
}

function Gauge({ pct }) {
  const r = 70, c = 2 * Math.PI * r, dash = pct * c;
  const col = pct < 0.15 ? "var(--danger)" : "var(--accent)";
  return (
    <svg viewBox="0 0 180 180" width="160" height="160">
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--border)" strokeWidth="15" />
      <circle cx="90" cy="90" r={r} fill="none" stroke={col} strokeWidth="15" strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`} transform="rotate(-90 90 90)" />
      <text x="90" y="86" textAnchor="middle" fontSize="34" fontWeight="700" fill="var(--text)">{Math.round(pct * 100)}%</text>
      <text x="90" y="108" textAnchor="middle" fontSize="13" fill="var(--muted)">{t("остаток")}</text>
    </svg>
  );
}

function SpoolGraphic({ color }) {
  const c = color || "#6b7280";
  // viewBox 120×120, svg тянется на весь контейнер (адаптивно).
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-label={t("катушка")} style={{ display: "block" }}>
      <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle cx="60" cy="60" r="50" fill={c} />
      {/* витки филамента */}
      <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="36" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="29" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
      {/* ступица */}
      <circle cx="60" cy="60" r="24" fill="var(--panel)" stroke="var(--border)" strokeWidth="2" />
      <circle cx="60" cy="60" r="9" fill="var(--bg)" stroke="var(--border)" strokeWidth="2" />
    </svg>
  );
}

function Metric({ icon, label, value, sub }) {
  // Температура окрашена токеном --hot: это то, что принтер нагрел.
  const hot = icon === "thermometer" || icon === "flame";
  return (
    <div>
      <div className="spec-label inline-ico">{icon && <Icon name={icon} size={13} className={hot ? "hot" : undefined} />}{label}</div>
      <div className="spec-value">{value}</div>
      {sub && <div className="spec-sub">{sub}</div>}
    </div>
  );
}

export default function SpoolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [spool, setSpool] = useState(null);
  const [events, setEvents] = useState([]);
  const [card, setCard] = useState(null);
  const [placement, setPlacement] = useState(null);
  const [locations, setLocations] = useState([]);
  const [slots, setSlots] = useState([]);
  const [labelOpts, setLabelOpts] = useState(null);
  const [error, setError] = useState(null);
  const [weighInput, setWeighInput] = useState("");
  const [adjustInput, setAdjustInput] = useState("");
  const [size, setSize] = useState("classic");
  const [fieldSlots, setFieldSlots] = useState(["nozzle_temp", "bed_temp", "pressure_advance", "flow_info"]);
  const [showLabel, setShowLabel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  function load() {
    api.get(`/api/spools/${id}`).then(setSpool).catch(() => {});
    api.get(`/api/spools/${id}/events`).then(setEvents).catch(() => {});
    api.get(`/api/spools/${id}/card`).then(setCard).catch(() => {});
    api.get(`/api/spools/${id}/placement`).then(setPlacement).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get("/api/locations").then(setLocations).catch(() => {});
    api.get("/api/spools/label-options").then((o) => { setLabelOpts(o); if (o.default_fields) setFieldSlots(o.default_fields); }).catch(() => {});
    (async () => {
      const printers = await api.get("/api/printers").catch(() => []);
      const all = [];
      for (const p of printers) {
        const ss = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        for (const s of ss) all.push({ id: s.id, label: `${p.name} / ${s.name || "Slot " + s.slot_index}` });
      }
      setSlots(all);
    })();
  }, [id]);

  // Живой предпросмотр этикетки: перегенерируем PDF при смене размера/полей.
  useEffect(() => {
    if (!showLabel) return;
    let active = true;
    const fields = fieldSlots.filter((f) => f && f !== "none").join(",");
    const t = setTimeout(async () => {
      try {
        const u = await api.blobUrl(`/api/spools/${id}/label.png?size=${size}&fields=${fields}`);
        if (active) setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return u; });
        else URL.revokeObjectURL(u);
      } catch { /* игнорируем */ }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [showLabel, size, fieldSlots, id]);

  if (!spool) return <div>{t("Загрузка…")}</div>;

  const remaining = Number(spool.current_weight_g);
  const capacity = Number(spool.initial_filament_weight_g) || 1000;
  const pct = Math.max(0, Math.min(1, remaining / capacity));
  const density = spool.specs?.density || card?.density_g_cm3;
  const dia = spool.diameter_mm || card?.diameter_mm || 1.75;
  const lenLeft = lengthM(remaining, density, dia);
  const lenTotal = lengthM(capacity, density, dia);
  const prints = Math.round(remaining / 50);

  const title = spoolTitle(spool.manufacturer || card?.brand, card?.name || spool.label);
  const material = spool.material || card?.material;
  const colorName = spool.color_name || card?.color_name;
  const colorHex = spool.color_hex || card?.color_hex;
  const nozzle = spool.hotend_temp ? `${spool.hotend_temp}°C` : (card?.nozzle_temp || "—");
  const bed = spool.bed_temp ? `${spool.bed_temp}°C` : (card?.bed_temp || "—");
  const fan = spool.fan_speed != null ? `${spool.fan_speed}%` : (card?.fan_percent != null ? `${card.fan_percent}%` : "—");
  const flow = spool.flow_rate != null ? `${Number(spool.flow_rate)}%` : "—";
  const pa = spool.specs?.pressure_advance != null ? String(spool.specs.pressure_advance) : "—";

  async function weigh() {
    setError(null);
    try { await api.post(`/api/spools/${id}/weigh`, { total_weight_g: Number(weighInput) }); setWeighInput(""); load(); }
    catch (e) { setError(e.message); }
  }
  async function adjust() {
    setError(null);
    try { await api.post(`/api/spools/${id}/adjust`, { new_weight_g: Number(adjustInput) }); setAdjustInput(""); load(); }
    catch (e) { setError(e.message); }
  }
  async function setLocation(locationId) {
    try { await api.post(`/api/spools/${id}/move`, { location_id: locationId || null }); load(); } catch (e) { setError(e.message); }
  }
  async function assignSlot(slotId) {
    if (!slotId) return;
    try { await api.post(`/api/slots/${slotId}/assign-spool`, { spool_id: id }); load(); } catch (e) { setError(e.message); }
  }
  async function unassignSlot() {
    if (!placement?.slot) return;
    try { await api.post(`/api/slots/${placement.slot.slot_id}/unassign-spool`); load(); } catch (e) { setError(e.message); }
  }
  const fieldsQuery = () => fieldSlots.filter((f) => f && f !== "none").join(",");
  function downloadLabel() {
    api.download(`/api/spools/${id}/label.pdf?size=${size}&fields=${fieldsQuery()}`, { filename: `spool-${size}.pdf` }).catch((e) => setError(e.message));
  }
  async function viewLabel() {
    try { window.open(await api.blobUrl(`/api/spools/${id}/label.pdf?size=${size}&fields=${fieldsQuery()}`), "_blank"); } catch (e) { setError(e.message); }
  }
  function copyProfile() {
    const text = `Nozzle ${nozzle}, Bed ${bed}, Fan ${fan}, Flow ${flow}`;
    navigator.clipboard?.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const locName = placement?.slot
    ? `${placement.slot.printer_name} / ${placement.slot.slot_name || "Slot " + placement.slot.slot_index}`
    : placement?.location_name;

  return (
    <div>
      {/* Хлебные крошки + действия */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="muted"><Link to="/spools">{t("Катушки")}</Link> / {title}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={() => navigate(`/spools/${id}/edit`)}><Icon name="pencil" /> {t("Редактировать")}</button>
          <button onClick={() => navigate("/gcode")}>{t("＋ Учесть печать")}</button>
        </div>
      </div>

      {/* Заголовок */}
      <div style={{ margin: "10px 0 4px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }} className="muted">
        <span className="inline-ico"><Icon name="tag" size={14} /> {spool.sku || spool.label || "—"}</span>
        {locName && <span className="inline-ico">• <Icon name="pin" size={14} /> {locName}</span>}
        <span className="badge in_use">{STATUS_RU[spool.status] || spool.status}</span>
      </div>
      <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
      <div className="sd-tags" style={{ marginBottom: 16 }}>
        {spool.manufacturer && <span className="sd-tag">{spool.manufacturer}</span>}
        {material && <span className="sd-tag">{material}</span>}
        {(colorName || colorHex) && <span className="sd-tag"><span className="swatch" style={{ background: colorHex || "var(--muted)", width: 12, height: 12 }} />{colorName || colorHex}</span>}
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="sd-grid">
        {/* Левая колонка */}
        <div>
          {spool.photo
            ? <img className="sd-photo" src={spool.photo} alt="" style={{ marginBottom: 16 }} />
            : <div className="sd-photo" style={{ marginBottom: 16, position: "relative", padding: "6%" }}>
                <SpoolGraphic color={colorHex} />
                <span className="muted" style={{ position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center", fontSize: 13 }}>{t("Нет фото")}</span>
              </div>}

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>{t("Характеристики")}</h3>
            <div className="spec-grid">
              <Metric icon="weight" label={t("Вес нетто")} value={`${capacity.toFixed(0)}${t("г")}`} />
              <Metric icon="diameter" label={t("Диаметр")} value={`${Number(dia)}${t("мм")}`} />
              <Metric icon="◎" label={t("Пустая катушка")} value={spool.empty_spool_weight_g != null ? `${Number(spool.empty_spool_weight_g).toFixed(0)}${t("г")}` : "—"} sub={t("тара")} />
              <Metric icon="calendar" label={t("Куплена")} value={fmtDate(spool.purchase_date)} sub={spool.price != null ? `${Number(spool.price)} ${spool.currency}` : null} />
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">{t("QR и этикетка")}</h3>
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 10 }}>
              {card?.qr_png_base64 && <img src={card.qr_png_base64} alt="QR" width={96} height={96} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }} />}
              <div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{t("Отсканируйте, чтобы открыть карточку с телефона.")}</div>
                <button className="secondary" onClick={() => setShowLabel(!showLabel)}><Icon name="download" /> {t("Печать этикетки")}</button>
              </div>
            </div>
            {showLabel && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {(labelOpts?.sizes || []).map((s) => (
                    <button key={s.key} className={size === s.key ? "" : "secondary"} style={{ textAlign: "left" }} onClick={() => setSize(s.key)}>
                      {s.key}<div style={{ fontSize: 11, opacity: 0.7 }}>{s.width_mm}×{s.height_mm}{t("мм")}</div>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  {fieldSlots.map((val, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span className="muted" style={{ width: 60 }}>{t("Поле")}{" "}{i + 1}</span>
                      <select value={val} style={{ flex: 1 }} onChange={(e) => { const n = [...fieldSlots]; n[i] = e.target.value; setFieldSlots(n); }}>
                        {(labelOpts?.fields || []).map((f) => <option key={f.key} value={f.key}>{f.label || t("— нет —")}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t("Предпросмотр (как на печати)")}</div>
                  {previewUrl
                    ? <img alt={t("Предпросмотр этикетки")} src={previewUrl} style={{ display: "block", width: "100%", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }} />
                    : <div className="muted" style={{ padding: 20, border: "1px dashed var(--border)", borderRadius: 8, textAlign: "center" }}>{t("Генерирую…")}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="secondary" onClick={viewLabel}>{t("Открыть крупно")}</button>
                  <button onClick={downloadLabel}>{t("Скачать PDF")}</button>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">{t("Размещение")}</h3>
            <div className="field-2" style={{ marginTop: 10 }}>
              <div>
                <label>{t("Место хранения")}</label>
                <select value={spool.location_id || ""} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">{t("— не указано —")}</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label>{t("В принтере (слот)")}</label>
                <select value={placement?.slot?.slot_id || ""} onChange={(e) => assignSlot(e.target.value)}>
                  <option value="">{t("— не в принтере —")}</option>
                  {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                {placement?.slot && <button className="secondary" style={{ marginTop: 6 }} onClick={unassignSlot}>{t("Снять со слота")}</button>}
              </div>
            </div>
          </div>

          <DryingCard spool={spool} events={events} onDone={load} />
        </div>

        {/* Правая колонка */}
        <div>
          <div className="card">
            <h3 className="card-title">{t("Текущий статус")}</h3>
            <div style={{ display: "flex", gap: 24, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <Gauge pct={pct} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="row">
                  <div>
                    <div className="spec-label">{t("Остаток (вес)")}</div>
                    <div style={{ fontSize: 30, fontWeight: 700 }}>{remaining.toFixed(0)} <span className="muted" style={{ fontSize: 16 }}>/ {capacity.toFixed(0)}{t("г")}</span></div>
                  </div>
                  <div>
                    <div className="spec-label">{t("Остаток (длина)")}</div>
                    <div style={{ fontSize: 30, fontWeight: 700 }}>{lenLeft.toFixed(0)} <span className="muted" style={{ fontSize: 16 }}>/ {lenTotal.toFixed(0)}{t("м")}</span></div>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>{t("Хватит примерно на ~")}{prints}{" "}{t("печатей (по 50 г).")}</div>
              </div>
            </div>
            {/* Обновление остатка */}
            <div className="field-2" style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div>
                <label>{t("Взвесить (общий вес с катушкой), г")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" value={weighInput} onChange={(e) => setWeighInput(e.target.value)} />
                  <button className="secondary" onClick={weigh} disabled={!weighInput}>OK</button>
                </div>
              </div>
              <div>
                <label>{t("Указать остаток вручную, г")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" value={adjustInput} onChange={(e) => setAdjustInput(e.target.value)} />
                  <button className="secondary" onClick={adjust} disabled={!adjustInput}>OK</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("Рекомендуемый профиль печати")}</h3>
              <button className="secondary" onClick={copyProfile}><Icon name={copied ? "check" : "copy"} /> {copied ? t("Скопировано") : t("Копировать")}</button>
            </div>
            <div className="profile-grid" style={{ marginTop: 14 }}>
              <Metric icon="thermometer" label={t("Сопло")} value={nozzle} />
              <Metric icon="thermometer" label={t("Стол")} value={bed} />
              <Metric icon="fan" label={t("Обдув")} value={fan} />
              <Metric icon="droplet" label="Flow Rate" value={flow} />
              <Metric icon="gauge" label="Pressure Adv (K)" value={pa} />
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">{t("История использования")}</h3>
            <table className="cards-mobile" style={{ marginTop: 10 }}>
              <thead><tr><th>{t("Дата")}</th><th>{t("Событие")}</th><th>{t("Объём")}</th><th>{t("Статус")}</th></tr></thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td data-label={t("Дата")}>{fmtDate(ev.created_at)}</td>
                    <td data-label={t("Событие")}>{tReason(ev.reason) || EVENT_RU[ev.event_type] || ev.event_type}</td>
                    <td data-label={t("Объём")} style={{ color: ev.delta_g < 0 ? "var(--danger)" : ev.delta_g > 0 ? "var(--ok)" : "var(--text)" }}>
                      {ev.delta_g != null ? `${ev.delta_g > 0 ? "+" : ""}${Number(ev.delta_g).toFixed(0)}${t("г")}` : "—"}
                    </td>
                    <td data-label={t("Статус")}><span className="act-tag updated">{EVENT_RU[ev.event_type] || ev.event_type}</span></td>
                  </tr>
                ))}
                {events.length === 0 && <tr><td colSpan={4} className="muted">{t("Пока нет событий")}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3 className="card-title">{t("Заметки")}</h3>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{spool.notes || <span className="muted">{t("Заметок нет.")}</span>}</div>
          </div>
        </div>
      </div>

      {/* Характеристики филамента */}
      {spool.specs && Object.keys(spool.specs).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">{t("Характеристики филамента")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginTop: 12 }}>
            {SPEC_GROUPS.map((g) => {
              const items = g.fields
                .map((f) => ({ f, v: fmtSpec(f, spool.specs[f.key]) }))
                .filter((x) => x.v != null);
              if (!items.length) return null;
              return (
                <div key={g.title}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{g.title}</div>
                  <div>
                    {items.map(({ f, v }) => (
                      <div key={f.key} className="row-item">
                        <span className="k">{f.label}</span>
                        <span>{f.key.endsWith("_url") ? <a href={v} target="_blank" rel="noreferrer">{t("ссылка ↗")}</a> : v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


function DryingCard({ spool, events, onDone }) {
  const lastDried = events.find((e) => e.event_type === "dried");
  const specs = spool.specs || {};
  const [temp, setTemp] = useState(specs.drying_temp || 50);
  const [hours, setHours] = useState(specs.dry_time_hours || 4);
  const [busy, setBusy] = useState(false);

  async function markDried() {
    setBusy(true);
    try {
      await api.post(`/api/spools/${spool.id}/dry`, { temp_c: Number(temp) || null, hours: Number(hours) || null });
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3 className="card-title inline-ico"><Icon name="droplet" size={15} /> {t("Сушка филамента")}</h3>
      <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
        {t("Последняя сушка:")} {lastDried ? fmtDate(lastDried.created_at) : t("не сушилась")}
      </div>
      <div className="field-2" style={{ marginTop: 10 }}>
        <div>
          <label>{t("Температура, °C")}</label>
          <input type="number" value={temp} onChange={(e) => setTemp(e.target.value)} />
        </div>
        <div>
          <label>{t("Время, ч")}</label>
          <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
      </div>
      <button className="secondary" style={{ marginTop: 10, width: "100%" }} disabled={busy} onClick={markDried}>
        <Icon name="check" /> {t("Просушена")}
      </button>
    </div>
  );
}
