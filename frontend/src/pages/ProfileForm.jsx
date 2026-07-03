import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { profileSpecGroups, MATERIALS } from "../specFields.js";
import { t } from "../i18n.js";

const COLS = [
  "brand", "name", "material", "color_name", "color_hex", "diameter_mm",
  "nozzle_temp_min", "nozzle_temp_max", "bed_temp_min", "bed_temp_max",
  "density_g_cm3", "flow_ratio", "max_volumetric_speed", "pressure_advance",
  "fan_percent", "print_speed_mm_s", "notes",
];
const EMPTY = Object.fromEntries(COLS.map((k) => [k, ""]));
EMPTY.material = "PLA";
EMPTY.color_hex = "#3b82f6";
EMPTY.diameter_mm = "1.75";
EMPTY.is_public = false;
EMPTY.specs = {};

const num = (v) => (v === "" || v == null ? null : Number(v));
const SPEC_GROUPS = profileSpecGroups();

export default function ProfileForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (editing) {
      api.get(`/api/filament-profiles/${id}`).then((p) => {
        const f = { ...EMPTY };
        for (const k of COLS) if (p[k] != null) f[k] = String(p[k]);
        f.is_public = !!p.is_public;
        f.specs = p.specs || {};
        setForm(f);
      }).catch(() => {});
    }
  }, [id]);

  const set = (k) => (e) => setForm({ ...form, [k]: k === "is_public" ? e.target.checked : e.target.value });
  const setSpec = (k) => (e) => setForm({ ...form, specs: { ...form.specs, [k]: e.target.value } });
  function toggleMulti(key, opt) {
    const cur = Array.isArray(form.specs?.[key]) ? form.specs[key] : [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    setForm({ ...form, specs: { ...form.specs, [key]: next } });
  }

  function buildSpecs() {
    const out = {};
    for (const g of SPEC_GROUPS) for (const f of g.fields) {
      const v = form.specs?.[f.key];
      if (v === undefined || v === null || v === "") continue;
      if (f.type === "multiselect") { if (Array.isArray(v) && v.length) out[f.key] = v; }
      else out[f.key] = f.type === "number" ? Number(v) : v;
    }
    return Object.keys(out).length ? out : null;
  }

  async function save() {
    setError(null);
    if (!form.name) { setError(t("Укажите название профиля")); return; }
    if (!form.material) { setError(t("Укажите материал")); return; }
    const body = {
      brand: form.brand || null, name: form.name, material: form.material,
      color_name: form.color_name || null, color_hex: form.color_hex || null,
      diameter_mm: num(form.diameter_mm),
      nozzle_temp_min: num(form.nozzle_temp_min), nozzle_temp_max: num(form.nozzle_temp_max),
      bed_temp_min: num(form.bed_temp_min), bed_temp_max: num(form.bed_temp_max),
      density_g_cm3: num(form.density_g_cm3), flow_ratio: num(form.flow_ratio),
      max_volumetric_speed: num(form.max_volumetric_speed), pressure_advance: num(form.pressure_advance),
      fan_percent: num(form.fan_percent), print_speed_mm_s: num(form.print_speed_mm_s),
      notes: form.notes || null, specs: buildSpecs(),
    };
    try {
      if (editing) await api.patch(`/api/filament-profiles/${id}`, body);
      else await api.post("/api/filament-profiles", body);
      navigate("/profiles");
    } catch (e) { setError(e.message); }
  }

  const F = (k, label, type = "text", unit) => (
    <div>
      <label>{label}{unit ? `, ${unit}` : ""}</label>
      <input type={type} value={form[k]} onChange={set(k)} />
    </div>
  );

  return (
    <div>
      <Link to="/profiles">{t("← К профилям")}</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 16px" }}>
        <h2 style={{ margin: 0 }}>{editing ? t("Редактирование профиля") : t("Новый профиль")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={() => navigate("/profiles")}>{t("Отмена")}</button>
          <button onClick={save}>{t("Сохранить")}</button>
        </div>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <h3 className="card-title">{t("Филамент и цвет")}</h3>
        <div className="spec-form-grid" style={{ marginTop: 12 }}>
          {F("brand", t("Бренд"))}
          {F("name", t("Название"))}
          <div>
            <label>{t("Материал")}</label>
            <select value={form.material} onChange={set("material")}>
              {(MATERIALS.includes(form.material) ? MATERIALS : [form.material, ...MATERIALS]).map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          {F("color_name", t("Название цвета"))}
          <div>
            <label>{t("Цвет (HEX)")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="color" style={{ width: 44, padding: 2 }} value={form.color_hex} onChange={set("color_hex")} />
              <input value={form.color_hex} onChange={set("color_hex")} />
            </div>
          </div>
          {F("diameter_mm", t("Диаметр"), "number", t("мм"))}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">{t("Настройки печати")}</h3>
        <div className="card-sub">{t("Свои значения для этого цвета.")}</div>
        <div className="spec-form-grid">
          {F("nozzle_temp_min", t("Сопло min"), "number", "°C")}
          {F("nozzle_temp_max", t("Сопло max"), "number", "°C")}
          {F("bed_temp_min", t("Стол min"), "number", "°C")}
          {F("bed_temp_max", t("Стол max"), "number", "°C")}
          {F("density_g_cm3", t("Плотность"), "number", t("г/см³"))}
          {F("flow_ratio", "Flow Ratio", "number")}
          {F("max_volumetric_speed", t("Макс. об. скорость"), "number", t("мм³/с"))}
          {F("pressure_advance", "Pressure Advance (K)", "number")}
          {F("fan_percent", t("Обдув"), "number", "%")}
          {F("print_speed_mm_s", t("Скорость"), "number", t("мм/с"))}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">{t("Доп. характеристики")}</h3>
        {SPEC_GROUPS.map((g) => (
          <div key={g.title} style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{g.title}</div>
            <div className="spec-form-grid">
              {g.fields.filter((f) => f.type !== "multiselect").map((f) => (
                <div key={f.key}>
                  <label>{f.label}{f.unit ? `, ${f.unit}` : ""}</label>
                  <input type={f.type} value={form.specs?.[f.key] ?? ""} onChange={setSpec(f.key)} placeholder={f.placeholder || ""} />
                </div>
              ))}
            </div>
            {g.fields.filter((f) => f.type === "multiselect").map((f) => (
              <div key={f.key} style={{ marginTop: 10 }}>
                <label>{f.label}</label>
                <div className="chip-select">
                  {f.options.map((opt) => {
                    const on = Array.isArray(form.specs?.[f.key]) && form.specs[f.key].includes(opt);
                    return <button type="button" key={opt} className={`chip ${on ? "chip-on" : ""}`} onClick={() => toggleMulti(f.key, opt)}>{on ? "✓ " : ""}{opt}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="card-title">{t("Заметки")}</h3>
        <textarea rows={3} value={form.notes} onChange={set("notes")} />
      </div>
    </div>
  );
}
