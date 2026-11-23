import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { Button as AriaButton } from "react-aria-components";
import { Camera01, SearchLg } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { Card, CardHeader, PageHeader, RemainingBar, SpoolSwatch } from "../components/ft/ui.jsx";
import { ColorField, NONE, Pick, SectionLabel, SpecGroupsForm, plain } from "../components/ft/form.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { api } from "../api/client.js";
import { SPEC_GROUPS, SPEC_FIELDS, MATERIALS } from "../specFields.js";
import { t } from "../i18n.js";
import { lowThresholdFor } from "../utils/spools.js";
import { locationPath } from "../utils/locations.js";

const DIAMETERS = ["1.75", "2.85", "3.0"];
const CURRENCIES = ["RUB", "USD", "EUR"];

const EMPTY = {
  label: "", manufacturer: "", sku: "", photo: "",
  material: "PLA", color_name: "", color_hex: "#426ef0", diameter_mm: "1.75",
  initial_filament_weight_g: "", empty_spool_weight_g: "", current_weight_g: "",
  location_id: "", purchase_date: "", price: "", currency: "RUB",
  barcode: "", hotend_temp: "", bed_temp: "", fan_speed: "", flow_rate: "",
  notes: "", specs: {},
};

// Уменьшает изображение до maxPx и возвращает data URL.
function resizeImage(file, maxPx = 400) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL("image/jpeg", 0.8));
    };
    img.src = URL.createObjectURL(file);
  });
}

export default function SpoolForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [form, setForm] = useState(EMPTY);
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState(null);
  const photoRef = useRef();

  useEffect(() => {
    api.get("/api/locations").then(setLocations).catch(() => {});
    if (editing) {
      api.get(`/api/spools/${id}`).then((s) => {
        const f = { ...EMPTY };
        for (const k of Object.keys(EMPTY)) {
          if (k === "specs" || k === "photo") continue;
          if (s[k] != null) f[k] = String(s[k]);
        }
        // В БД current_weight_g — чистый пластик; поле формы = вес катушки целиком
        // (как на весах), поэтому прибавляем тару, чтобы значение корректно round-trip'илось.
        if (s.current_weight_g != null) {
          f.current_weight_g = String(Number(s.current_weight_g) + Number(s.empty_spool_weight_g || 0));
        }
        f.photo = s.photo || "";
        f.specs = s.specs || {};
        setForm(f);
      }).catch(() => {});
    } else if (location.state?.catalog) {
      // Предзаполнение из каталога SpoolmanDB (кнопка «В инвентарь» на /profiles).
      pickCatalog(location.state.catalog);
    } else {
      // Предзаполнение из профиля (кнопка «В инвентарь» на /profiles).
      const profileId = searchParams.get("profile");
      if (profileId) api.get(`/api/filament-profiles/${profileId}`).then(pickCatalog).catch(() => {});
    }
  }, [id]);

  // Поля Untitled UI отдают в onChange уже значение, а не событие.
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setSpec = (k) => (v) => setForm((f) => ({ ...f, specs: { ...f.specs, [k]: v } }));

  // --- каталог филаментов: поиск и предзаполнение ---
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogResults, setCatalogResults] = useState([]);
  async function searchCatalog(q) {
    setCatalogQ(q);
    if (q.trim().length < 2) { setCatalogResults([]); return; }
    // Профили (свои + курируемый каталог) и общий каталог SpoolmanDB.
    const [profiles, sdb] = await Promise.all([
      api.get(`/api/filament-profiles?q=${encodeURIComponent(q)}`).catch(() => []),
      api.get(`/api/filament-catalog/search?q=${encodeURIComponent(q)}&limit=12`).catch(() => []),
    ]);
    setCatalogResults([...(profiles || []).slice(0, 8), ...(sdb || [])].slice(0, 20));
  }
  function pickCatalog(p) {
    const specs = { ...(p.specs || {}) };
    const map = {
      nozzle_min: p.nozzle_temp_min, nozzle_max: p.nozzle_temp_max,
      bed_min: p.bed_temp_min, bed_max: p.bed_temp_max,
      density: p.density_g_cm3, flow_ratio: p.flow_ratio,
      max_volumetric_speed: p.max_volumetric_speed, pressure_advance: p.pressure_advance,
    };
    for (const [k, v] of Object.entries(map)) if (v != null) specs[k] = Number(v);
    const w = (v, cur) => (v != null ? String(Number(v)) : cur);
    setForm((f) => ({
      ...f,
      // Записи SpoolmanDB — не локальный профиль, линковать нечего.
      filament_profile_id: p.source === "spoolmandb" ? null : p.id,
      manufacturer: p.brand || f.manufacturer,
      label: f.label || p.name || p.brand || "",
      material: p.material || f.material,
      color_name: p.color_name || f.color_name,
      color_hex: p.color_hex || f.color_hex,
      diameter_mm: p.diameter_mm ? String(Number(p.diameter_mm)) : f.diameter_mm,
      hotend_temp: p.nozzle_temp_max != null ? String(p.nozzle_temp_max) : f.hotend_temp,
      bed_temp: p.bed_temp_max != null ? String(p.bed_temp_max) : f.bed_temp,
      initial_filament_weight_g: w(p.initial_filament_weight_g, f.initial_filament_weight_g),
      empty_spool_weight_g: w(p.empty_spool_weight_g, f.empty_spool_weight_g),
      specs,
    }));
    setCatalogQ(""); setCatalogResults([]);
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const photo = await resizeImage(file);
    setForm((f) => ({ ...f, photo }));
  }

  const num = (v) => (v === "" || v == null ? null : Number(v));
  function buildSpecs() {
    const out = {};
    for (const f of SPEC_FIELDS) {
      const v = form.specs?.[f.key];
      if (v === undefined || v === null || v === "") continue;
      if (f.type === "multiselect") {
        if (Array.isArray(v) && v.length) out[f.key] = v;
      } else {
        out[f.key] = f.type === "number" ? Number(v) : v;
      }
    }
    // pressure_advance редактируется в «Переопределениях печати», не в списке specs
    const pa = form.specs?.pressure_advance;
    if (pa !== undefined && pa !== null && pa !== "") out.pressure_advance = Number(pa);
    return Object.keys(out).length ? out : null;
  }
  function toggleMulti(key, opt) {
    setForm((f) => {
      const cur = Array.isArray(f.specs?.[key]) ? f.specs[key] : [];
      const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
      return { ...f, specs: { ...f.specs, [key]: next } };
    });
  }
  async function save() {
    setError(null);
    if (!form.label) { setError(t("Укажите название катушки")); return; }
    // Поле «текущий вес» — вес катушки целиком; в БД храним чистый пластик = вес − тара.
    const grossG = num(form.current_weight_g);
    const netCurrentG = grossG == null ? null : Math.max(0, grossG - (num(form.empty_spool_weight_g) || 0));
    const body = {
      label: form.label, manufacturer: form.manufacturer || null, sku: form.sku || null,
      photo: form.photo || null, material: form.material || null,
      color_name: form.color_name || null, color_hex: form.color_hex || null,
      diameter_mm: num(form.diameter_mm), location_id: form.location_id || null,
      initial_filament_weight_g: num(form.initial_filament_weight_g),
      empty_spool_weight_g: num(form.empty_spool_weight_g),
      current_weight_g: netCurrentG,
      purchase_date: form.purchase_date || null, price: num(form.price), currency: form.currency,
      barcode: form.barcode || null, hotend_temp: num(form.hotend_temp),
      bed_temp: num(form.bed_temp), fan_speed: num(form.fan_speed), flow_rate: num(form.flow_rate),
      notes: form.notes || null, specs: buildSpecs(),
    };
    try {
      if (editing) {
        await api.patch(`/api/spools/${id}`, body);
        navigate(`/spools/${id}`);
      } else {
        if (body.current_weight_g == null) body.current_weight_g = body.initial_filament_weight_g;
        const created = await api.post("/api/spools", body);
        navigate(`/spools/${created.id}`);
      }
    } catch (e) { setError(e.message); }
  }

  const capacity = num(form.initial_filament_weight_g) || 1000;
  const tare = num(form.empty_spool_weight_g) || 0;
  const grossInput = num(form.current_weight_g);
  // Поле — вес катушки целиком; чистый остаток = вес − тара. Пусто = полная катушка.
  const remaining = grossInput == null ? capacity : Math.max(0, grossInput - tare);
  const pct = Math.max(0, Math.min(1, remaining / capacity));
  const benchys = Math.round(remaining / 30);
  const low = remaining <= lowThresholdFor(capacity);

  const materials = MATERIALS.includes(form.material) ? MATERIALS : [form.material, ...MATERIALS];
  const locItems = [{ id: NONE, label: t("— не указано —") }, ...locations.map((l) => ({ id: l.id, label: locationPath(locations, l.id) }))];
  const heading = editing ? t("Редактирование катушки") : t("Новая катушка");

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("Катушки"), href: "/spools" }, { label: heading }]}
        title={heading}
        actions={
          <>
            <Button size="md" color="secondary" onClick={() => navigate(-1)}>{t("Отмена")}</Button>
            <Button size="md" onClick={save}>{t("Сохранить")}</Button>
          </>
        }
      />
      {error && <Notice tone="error" className="mb-6" onClose={() => setError(null)}>{error}</Notice>}

      {/* Подбор из каталога */}
      <Card className="mb-6">
        <CardHeader
          title={t("Подобрать из каталога")}
          description={t("Начните вводить бренд или материал — поля подставятся автоматически (можно править).")}
        />
        <div className="p-5">
          <div className="relative max-w-xl">
            <Input size="sm" icon={SearchLg} value={catalogQ} onChange={searchCatalog} placeholder={t("например LIDER-3D, Bambu PLA, PETG…")} />
            {catalogResults.length > 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg bg-primary p-1 shadow-lg ring-1 ring-secondary">
                {catalogResults.map((p) => (
                  <AriaButton
                    key={p.id || p.catalog_id}
                    onPress={() => pickCatalog(p)}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md bg-transparent px-3 py-2 text-left outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 focus-visible:-outline-offset-2"
                  >
                    <span className="text-sm font-medium text-primary">{[p.brand, p.name].filter(Boolean).join(" ")}</span>
                    <span className="text-xs text-tertiary">
                      {p.material}{p.nozzle_temp_max ? ` · ${t("сопло")} ~${p.nozzle_temp_max}°C` : ""}{p.source === "spoolmandb" ? " · SpoolmanDB" : ""}
                    </span>
                  </AriaButton>
                ))}
              </div>
            )}
          </div>
          {form.filament_profile_id && (
            <p className="mt-3 text-sm text-tertiary">{t("Данные подставлены из каталога. Цвет и вес укажите сами.")}</p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Левая колонка */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title={t("Общая информация")} />
            <div className="flex flex-col gap-5 p-5 sm:flex-row">
              <div>
                <p className="mb-1.5 text-sm font-medium text-secondary">{t("Фото катушки")}</p>
                <AriaButton
                  onPress={() => photoRef.current?.click()}
                  aria-label={t("Фото катушки")}
                  className="flex size-28 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-primary bg-secondary_alt text-sm text-tertiary outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {form.photo
                    ? <img src={form.photo} alt="" className="size-full object-cover" />
                    : <><Camera01 className="size-6 text-fg-quaternary" aria-hidden="true" /><span>{t("Загрузить")}</span></>}
                </AriaButton>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <Input size="sm" isRequired label={t("Название катушки")} value={form.label} onChange={set("label")} placeholder={t("например Ocean Blue Silk")} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input size="sm" label={t("Производитель")} value={form.manufacturer} onChange={set("manufacturer")} placeholder="PolyMaker" />
                  <Input size="sm" label={t("SKU / Артикул")} value={form.sku} onChange={set("sku")} placeholder={t("Необязательно")} />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={t("Материал и характеристики")} />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Pick label={t("Тип материала")} value={form.material} onChange={set("material")} items={plain(materials)} />
              <Pick label={t("Диаметр")} value={form.diameter_mm} onChange={set("diameter_mm")}
                items={DIAMETERS.map((d) => ({ id: d, label: `${d} ${t("мм")}` }))} />
              <ColorField label={t("Цвет")} value={form.color_hex} onChange={set("color_hex")} />
              <Input size="sm" label={t("Название цвета")} value={form.color_name} onChange={set("color_name")} placeholder={t("Название цвета")} />
              {/* Подписи длинные и переносятся по-разному, поэтому поля выравниваем по низу. */}
              <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2 sm:items-end">
                <Input size="sm" type="number" label={`${t("Вес филамента нетто (полная катушка)")}, ${t("г")}`}
                  value={form.initial_filament_weight_g} onChange={set("initial_filament_weight_g")} placeholder="1000" />
                <Input size="sm" type="number" label={`${t("Вес пустой катушки (тара)")}, ${t("г")}`}
                  value={form.empty_spool_weight_g} onChange={set("empty_spool_weight_g")} placeholder="200" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={t("Учёт и покупка")} />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Input size="sm" type="number" className="sm:col-span-2" label={`${t("Текущий вес катушки целиком (на весах)")}, ${t("г")}`}
                value={form.current_weight_g} onChange={set("current_weight_g")} placeholder="1232"
                hint={grossInput != null && tare > 0
                  ? `− ${t("тара")} ${tare.toFixed(0)}${t("г")} → ${remaining.toFixed(0)}${t("г")} ${t("чистого филамента")}`
                  : undefined} />
              <Pick label={t("Место хранения")} value={form.location_id || NONE}
                onChange={(k) => set("location_id")(k === NONE ? "" : k)} items={locItems} />
              <Input size="sm" type="date" label={t("Дата покупки")} value={form.purchase_date} onChange={set("purchase_date")} />
              <div className="flex items-end gap-2">
                <Input size="sm" type="number" label={t("Цена")} value={form.price} onChange={set("price")} placeholder="0" className="flex-1" />
                <Pick aria-label={t("Валюта")} value={form.currency} onChange={set("currency")} items={plain(CURRENCIES)} className="w-28" />
              </div>
            </div>
          </Card>
        </div>

        {/* Правая колонка */}
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <SectionLabel>{t("ПРЕДПРОСМОТР СТАТУСА")}</SectionLabel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-display-lg font-semibold text-primary tabular-nums">{Math.round(pct * 100)}%</span>
                <span className="ml-2 text-sm text-tertiary">{t("остаток")}</span>
              </div>
              {form.photo
                ? <img src={form.photo} alt="" className="size-14 rounded-xl object-cover ring-1 ring-secondary" />
                : <SpoolSwatch color={form.color_hex} size="lg" />}
            </div>
            <RemainingBar
              className="mt-4"
              grams={remaining.toFixed(0)}
              pct={pct}
              color={low ? "var(--color-utility-red-500, #f04438)" : form.color_hex}
            />
            <p className="mt-1 text-right text-sm text-tertiary tabular-nums">{t("из")} {capacity.toFixed(0)} {t("г")}</p>
            <p className="mt-3 text-sm text-tertiary">{t("⏱ Хватит примерно на ~")}{benchys}{" "}{t("стандартных Benchy.")}</p>
          </Card>

          <Card>
            <CardHeader title={t("Штрихкод")} description={t("Штрихкод производителя (необязательно).")} />
            <div className="p-5">
              <Input size="sm" aria-label={t("Штрихкод")} value={form.barcode} onChange={set("barcode")} placeholder={t("Введите код…")} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t("Переопределения печати")} description={t("Необязательно: настройки именно для этой катушки.")} />
            <div className="grid grid-cols-2 gap-4 p-5">
              <Input size="sm" type="number" label={`${t("Сопло")}, °C`} value={form.hotend_temp} onChange={set("hotend_temp")} placeholder="210" />
              <Input size="sm" type="number" label={`${t("Стол")}, °C`} value={form.bed_temp} onChange={set("bed_temp")} placeholder="60" />
              <Input size="sm" type="number" label={`${t("Обдув")}, %`} value={form.fan_speed} onChange={set("fan_speed")} placeholder="100" />
              <Input size="sm" type="number" label="Flow Rate, %" value={form.flow_rate} onChange={set("flow_rate")} placeholder="95" />
              <Input size="sm" type="number" label="Pressure Advance (K)" step="0.001" className="col-span-2 sm:col-span-1"
                value={String(form.specs?.pressure_advance ?? "")} onChange={setSpec("pressure_advance")} placeholder="0.02" />
            </div>
          </Card>

          <Card>
            <CardHeader title={t("Заметки")} />
            <div className="p-5">
              <TextArea size="sm" aria-label={t("Заметки")} rows={4} value={form.notes} onChange={set("notes")} placeholder={t("Комментарии к катушке…")} />
            </div>
          </Card>
        </div>
      </div>

      {/* Расширенные характеристики филамента */}
      <Card className="mt-6">
        <CardHeader
          title={t("Характеристики филамента")}
          description={t("Дополнительные данные профиля (как на 3dfilamentprofiles.com). Все поля необязательны.")}
        />
        <div className="p-5">
          <SpecGroupsForm groups={SPEC_GROUPS} specs={form.specs} setSpec={setSpec} toggleMulti={toggleMulti} />
        </div>
      </Card>
    </div>
  );
}
