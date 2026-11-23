import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { Card, CardHeader, PageHeader } from "../components/ft/ui.jsx";
import { ColorField, Pick, SpecGroupsForm, plain } from "../components/ft/form.jsx";
import { Notice } from "../components/ft/printer.jsx";
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

  // Поля Untitled UI отдают в onChange уже значение, а не событие.
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setSpec = (k) => (v) => setForm((f) => ({ ...f, specs: { ...f.specs, [k]: v } }));
  function toggleMulti(key, opt) {
    setForm((f) => {
      const cur = Array.isArray(f.specs?.[key]) ? f.specs[key] : [];
      const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
      return { ...f, specs: { ...f.specs, [key]: next } };
    });
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

  // Поле формы: подпись с единицей и значение из form.
  const F = (k, label, type = "text", unit, extra) => (
    <Input size="sm" type={type} label={`${label}${unit ? `, ${unit}` : ""}`} value={form[k]} onChange={set(k)} {...extra} />
  );

  const materials = MATERIALS.includes(form.material) ? MATERIALS : [form.material, ...MATERIALS];
  const heading = editing ? t("Редактирование профиля") : t("Новый профиль");

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("Профили филамента"), href: "/profiles" }, { label: heading }]}
        title={heading}
        actions={
          <>
            <Button size="md" color="secondary" onClick={() => navigate("/profiles")}>{t("Отмена")}</Button>
            <Button size="md" onClick={save}>{t("Сохранить")}</Button>
          </>
        }
      />
      {error && <Notice tone="error" className="mb-6" onClose={() => setError(null)}>{error}</Notice>}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={t("Филамент и цвет")} />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {F("brand", t("Бренд"))}
            {F("name", t("Название"), "text", undefined, { isRequired: true })}
            <Pick label={t("Материал")} value={form.material} onChange={set("material")} items={plain(materials)} />
            {F("color_name", t("Название цвета"))}
            <ColorField label={t("Цвет (HEX)")} value={form.color_hex} onChange={set("color_hex")} />
            {F("diameter_mm", t("Диаметр"), "number", t("мм"))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Настройки печати")} description={t("Свои значения для этого цвета.")} />
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {F("nozzle_temp_min", t("Сопло min"), "number", "°C")}
            {F("nozzle_temp_max", t("Сопло max"), "number", "°C")}
            {F("bed_temp_min", t("Стол min"), "number", "°C")}
            {F("bed_temp_max", t("Стол max"), "number", "°C")}
            {F("density_g_cm3", t("Плотность"), "number", t("г/см³"))}
            {F("flow_ratio", "Flow Ratio", "number")}
            {F("max_volumetric_speed", t("Макс. об. скорость"), "number", t("мм³/с"))}
            {F("pressure_advance", "Pressure Advance (K)", "number", undefined, { step: "0.001" })}
            {F("fan_percent", t("Обдув"), "number", "%")}
            {F("print_speed_mm_s", t("Скорость"), "number", t("мм/с"))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Доп. характеристики")} />
          <div className="p-5">
            <SpecGroupsForm groups={SPEC_GROUPS} specs={form.specs} setSpec={setSpec} toggleMulti={toggleMulti} />
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Заметки")} />
          <div className="p-5">
            <TextArea size="sm" aria-label={t("Заметки")} rows={3} value={form.notes} onChange={set("notes")} />
          </div>
        </Card>
      </div>
    </div>
  );
}
