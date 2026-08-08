import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { SPEC_GROUPS, SPEC_FIELDS, MATERIALS } from "../specFields.js";
import { t } from "../i18n.js";
import { lowThresholdFor } from "../utils/spools.js";
import Icon from "../components/Icon.jsx";
import { locationPath } from "../utils/locations.js";

const DIAMETERS = ["1.75", "2.85", "3.0"];

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

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setSpec = (k) => (e) => setForm({ ...form, specs: { ...form.specs, [k]: e.target.value } });

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
    setForm({ ...form, photo: await resizeImage(file) });
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
    const cur = Array.isArray(form.specs?.[key]) ? form.specs[key] : [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    setForm({ ...form, specs: { ...form.specs, [key]: next } });
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

  return (
    <div>
      <Link to="/spools">{t("← К инвентарю")}</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 16px" }}>
        <h2 style={{ margin: 0 }}>{editing ? t("Редактирование катушки") : t("Новая катушка")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={() => navigate(-1)}>{t("Отмена")}</button>
          <button onClick={save}>{t("Сохранить")}</button>
        </div>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Подбор из каталога */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="card-title">{t("Подобрать из каталога")}</h3>
        <div className="card-sub">{t("Начните вводить бренд или материал — поля подставятся автоматически (можно править).")}</div>
        <div style={{ position: "relative", maxWidth: 480 }}>
          <input value={catalogQ} onChange={(e) => searchCatalog(e.target.value)} placeholder={t("например LIDER-3D, Bambu PLA, PETG…")} />
          {catalogResults.length > 0 && (
            <div className="kebab-menu" style={{ left: 0, right: 0, maxWidth: 480, maxHeight: 280, overflowY: "auto" }}>
              {catalogResults.map((p) => (
                <button type="button" key={p.id || p.catalog_id} onClick={() => pickCatalog(p)}>
                  <strong>{[p.brand, p.name].filter(Boolean).join(" ")}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {p.material}{p.nozzle_temp_max ? ` · ${t("сопло")} ~${p.nozzle_temp_max}°C` : ""}{p.source === "spoolmandb" ? " · SpoolmanDB" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {form.filament_profile_id && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t("Данные подставлены из каталога. Цвет и вес укажите сами.")}</div>}
      </div>

      <div className="form-grid">
        {/* Левая колонка */}
        <div>
          <div className="card">
            <h3 className="card-title">{t("Общая информация")}</h3>
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              <div>
                <label>{t("Фото катушки")}</label>
                <div className="photo-drop" onClick={() => photoRef.current.click()}>
                  {form.photo ? <img src={form.photo} alt="" /> : <><Icon name="camera" size={22} /><div>{t("Загрузить")}</div></>}
                </div>
                <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
              </div>
              <div style={{ flex: 1 }}>
                <label>{t("Название катушки")} <span className="req">*</span></label>
                <input value={form.label} onChange={set("label")} placeholder={t("например Ocean Blue Silk")} />
                <div className="field-2" style={{ marginTop: 10 }}>
                  <div><label>{t("Производитель")}</label><input value={form.manufacturer} onChange={set("manufacturer")} placeholder="PolyMaker" /></div>
                  <div><label>{t("SKU / Артикул")}</label><input value={form.sku} onChange={set("sku")} placeholder={t("Необязательно")} /></div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">{t("Материал и характеристики")}</h3>
            <div className="field-2" style={{ marginTop: 12 }}>
              <div>
                <label>{t("Тип материала")} <span className="req">*</span></label>
                <select value={form.material} onChange={set("material")}>
                  {(MATERIALS.includes(form.material) ? MATERIALS : [form.material, ...MATERIALS]).map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label>{t("Цвет")} <span className="req">*</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="color" style={{ width: 44, padding: 2 }} value={form.color_hex} onChange={set("color_hex")} />
                  <input value={form.color_hex} onChange={set("color_hex")} />
                </div>
                <input style={{ marginTop: 8 }} value={form.color_name} onChange={set("color_name")} placeholder={t("Название цвета")} />
              </div>
            </div>
            <div className="field-2" style={{ marginTop: 10 }}>
              <div>
                <label>{t("Диаметр")} <span className="req">*</span></label>
                <select value={form.diameter_mm} onChange={set("diameter_mm")}>{DIAMETERS.map((d) => <option key={d} value={d}>{d}{" "}{t("мм")}</option>)}</select>
              </div>
              <div>
                <label>{t("Вес филамента нетто (полная катушка)")}</label>
                <div className="unit-input"><input type="number" value={form.initial_filament_weight_g} onChange={set("initial_filament_weight_g")} placeholder="1000" /><span className="unit">{t("г")}</span></div>
              </div>
            </div>
            <div className="field-2" style={{ marginTop: 10 }}>
              <div>
                <label>{t("Вес пустой катушки (тара)")}</label>
                <div className="unit-input"><input type="number" value={form.empty_spool_weight_g} onChange={set("empty_spool_weight_g")} placeholder="200" /><span className="unit">{t("г")}</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">{t("Учёт и покупка")}</h3>
            <div className="field-2" style={{ marginTop: 12 }}>
              <div>
                <label>{t("Текущий вес катушки целиком (на весах)")} <span className="req">*</span></label>
                <div className="unit-input"><input type="number" value={form.current_weight_g} onChange={set("current_weight_g")} placeholder="1232" /><span className="unit">{t("г")}</span></div>
                {grossInput != null && tare > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    − {t("тара")} {tare.toFixed(0)}{t("г")} → {remaining.toFixed(0)}{t("г")} {t("чистого филамента")}
                  </div>
                )}
              </div>
              <div>
                <label>{t("Место хранения")}</label>
                <select value={form.location_id} onChange={set("location_id")}>
                  <option value="">{t("— не указано —")}</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{locationPath(locations, l.id)}</option>)}
                </select>
              </div>
            </div>
            <div className="field-2" style={{ marginTop: 10 }}>
              <div><label>{t("Дата покупки")}</label><input type="date" value={form.purchase_date} onChange={set("purchase_date")} /></div>
              <div>
                <label>{t("Цена")}</label>
                <div className="unit-input">
                  <input type="number" value={form.price} onChange={set("price")} placeholder="0" />
                  <select style={{ width: 80 }} value={form.currency} onChange={set("currency")}><option>RUB</option><option>USD</option><option>EUR</option></select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Правая колонка */}
        <div>
          <div className="card">
            <div className="kpi-label">{t("ПРЕДПРОСМОТР СТАТУСА")}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 8 }}>
              <div><span style={{ fontSize: 40, fontWeight: 700 }}>{Math.round(pct * 100)}%</span> <span className="muted">{t("остаток")}</span></div>
              {form.photo
                ? <img src={form.photo} alt="" style={{ width: 70, height: 70, borderRadius: 10, objectFit: "cover" }} />
                : <div style={{ width: 70, height: 70, borderRadius: 10, background: form.color_hex, border: "1px solid var(--border)" }} />}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", fontWeight: 600, marginTop: 4 }}>{remaining.toFixed(0)}{t("г /")}{" "}{capacity.toFixed(0)}{t("г")}</div>
            <div className="progress" style={{ marginTop: 8, height: 12 }}><div style={{ width: `${Math.round(pct * 100)}%`, background: remaining <= lowThresholdFor(capacity) ? "var(--danger)" : "var(--accent)" }} /></div>
            <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>{t("⏱ Хватит примерно на ~")}{benchys}{" "}{t("стандартных Benchy.")}</div>
          </div>

          <div className="card">
            <h3 className="card-title">{t("Штрихкод")}</h3>
            <div className="card-sub">{t("Штрихкод производителя (необязательно).")}</div>
            <input value={form.barcode} onChange={set("barcode")} placeholder={t("Введите код…")} />
          </div>

          <div className="card">
            <h3 className="card-title">{t("Переопределения печати")}</h3>
            <div className="card-sub">{t("Необязательно: настройки именно для этой катушки.")}</div>
            <div className="field-2">
              <div><label>{t("Сопло")}</label><div className="unit-input"><input type="number" value={form.hotend_temp} onChange={set("hotend_temp")} placeholder="210" /><span className="unit">°C</span></div></div>
              <div><label>{t("Стол")}</label><div className="unit-input"><input type="number" value={form.bed_temp} onChange={set("bed_temp")} placeholder="60" /><span className="unit">°C</span></div></div>
            </div>
            <div className="field-2" style={{ marginTop: 10 }}>
              <div><label>{t("Обдув")}</label><div className="unit-input"><input type="number" value={form.fan_speed} onChange={set("fan_speed")} placeholder="100" /><span className="unit">%</span></div></div>
              <div><label>Flow Rate</label><div className="unit-input"><input type="number" value={form.flow_rate} onChange={set("flow_rate")} placeholder="95" /><span className="unit">%</span></div></div>
            </div>
            <div className="field-2" style={{ marginTop: 10 }}>
              <div><label>Pressure Advance (K)</label><input type="number" step="0.001" value={form.specs?.pressure_advance ?? ""} onChange={setSpec("pressure_advance")} placeholder="0.02" /></div>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">{t("Заметки")}</h3>
            <textarea rows={4} value={form.notes} onChange={set("notes")} placeholder={t("Комментарии к катушке…")} />
          </div>
        </div>
      </div>

      {/* Расширенные характеристики филамента */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="card-title">{t("Характеристики филамента")}</h3>
        <div className="card-sub">{t("Дополнительные данные профиля (как на 3dfilamentprofiles.com). Все поля необязательны.")}</div>
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
                    return (
                      <button type="button" key={opt} className={`chip ${on ? "chip-on" : ""}`} onClick={() => toggleMulti(f.key, opt)}>
                        {on ? "✓ " : ""}{opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
