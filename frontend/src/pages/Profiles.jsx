import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../api/auth.jsx";
import { t } from "../i18n.js";
import Icon from "../components/Icon.jsx";

export default function Profiles() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("mine"); // mine | catalog
  const [profiles, setProfiles] = useState([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);
  const fileRef = useRef();

  // Каталог SpoolmanDB: бренды A→Я + лениво подгружаемые филаменты по бренду.
  const [brands, setBrands] = useState([]);
  const [open, setOpen] = useState({});        // brand -> bool
  const [byBrand, setByBrand] = useState({});   // brand -> entries[]

  function load() {
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
  }
  useEffect(load, []);
  useEffect(() => {
    if (tab === "catalog" && brands.length === 0) {
      api.get("/api/filament-catalog/brands").then(setBrands).catch(() => {});
    }
  }, [tab]);

  async function toggleBrand(brand) {
    setOpen((o) => ({ ...o, [brand]: !o[brand] }));
    if (!byBrand[brand]) {
      const rows = await api.get(`/api/filament-catalog/search?brand=${encodeURIComponent(brand)}&limit=500`).catch(() => []);
      setByBrand((m) => ({ ...m, [brand]: rows }));
    }
  }

  async function importSlicer(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    try {
      const created = await api.postFile("/api/filament-profiles/import-slicer", file);
      navigate(`/profiles/${created.id}/edit`);
    } catch (err) { setMsg(t("Не удалось импортировать: ") + err.message); }
    e.target.value = "";
  }

  async function duplicate(id, newColor) {
    const copy = await api.post(`/api/filament-profiles/${id}/duplicate${newColor ? "?new_color=true" : ""}`);
    navigate(`/profiles/${copy.id}/edit`);
  }
  async function remove(id) {
    await api.del(`/api/filament-profiles/${id}`);
    load();
  }

  const rows = profiles.filter((p) => {
    if (p.owner_user_id !== user?.id) return false;
    if (!q) return true;
    return `${p.brand} ${p.name} ${p.material} ${p.color_name}`.toLowerCase().includes(q.toLowerCase());
  });

  const brandRows = q ? brands.filter((b) => b.brand.toLowerCase().includes(q.toLowerCase())) : brands;
  const temps = (p) => {
    const noz = p.nozzle_temp_max ? `${p.nozzle_temp_min && p.nozzle_temp_min !== p.nozzle_temp_max ? p.nozzle_temp_min + "–" : ""}${p.nozzle_temp_max}°` : "—";
    const bed = p.bed_temp_max ? `${p.bed_temp_min && p.bed_temp_min !== p.bed_temp_max ? p.bed_temp_min + "–" : ""}${p.bed_temp_max}°` : "—";
    return `${noz} / ${bed}`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{t("Профили филамента")}</h2>
          <div className="muted">{t("Свои настройки печати на каждый бренд/материал/цвет.")}</div>
        </div>
        {tab === "mine" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary" title={t("Профиль слайсера Bambu Studio / OrcaSlicer (.json)")} onClick={() => fileRef.current.click()}>{t("Импорт из слайсера (JSON)")}</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={importSlicer} />
            <button onClick={() => navigate("/profiles/new")}>{t("+ Добавить")}</button>
          </div>
        )}
      </div>
      {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}

      <div className="seg-toggle" role="tablist" style={{ marginTop: 14, maxWidth: 420 }}>
        <button type="button" className={`seg-item ${tab === "mine" ? "active" : ""}`} onClick={() => setTab("mine")}>{t("Мои профили")}</button>
        <button type="button" className={`seg-item ${tab === "catalog" ? "active" : ""}`} onClick={() => setTab("catalog")}>{t("Каталог SpoolmanDB")}</button>
      </div>

      <div className="inv-toolbar" style={{ marginTop: 12 }}>
        <input className="inv-search" placeholder={tab === "mine" ? t("Поиск по бренду, материалу, цвету…") : t("Поиск по бренду…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {tab === "mine" ? (
        <div className="card" style={{ padding: 0 }}>
          <table className="cards-mobile">
            <thead>
              <tr><th style={{ paddingLeft: 16 }}>{t("Бренд")}</th><th>{t("Название")}</th><th>{t("Материал")}</th><th>{t("Цвет")}</th><th>{t("Сопло / Стол")}</th><th>{t("Действия")}</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td data-label={t("Бренд")} style={{ paddingLeft: 16 }}>{p.brand || "—"}</td>
                  <td data-label={t("Название")}>{p.name}</td>
                  <td data-label={t("Материал")}>{p.material}</td>
                  <td data-label={t("Цвет")}><span className="swatch" style={{ background: p.color_hex || "#666", marginRight: 6 }} />{p.color_name || "—"}</td>
                  <td data-label={t("Сопло / Стол")} className="muted" style={{ fontSize: 13 }}>{temps(p)}</td>
                  <td data-label="">
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button className="secondary" title={t("Создать катушку из этого профиля")} onClick={() => navigate(`/spools/new?profile=${p.id}`)}>{t("＋ В Мои катушки")}</button>
                      <button className="icon-btn" title={t("Изменить")} onClick={() => navigate(`/profiles/${p.id}/edit`)}><Icon name="pencil" /></button>
                      <button className="icon-btn" title={t("Дублировать (новый цвет)")} onClick={() => duplicate(p.id, true)}>⧉</button>
                      <button className="icon-btn danger" title={t("Удалить")} onClick={() => remove(p.id)}><Icon name="trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>{t("Ничего не найдено")}</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {brandRows.map((b) => (
            <div key={b.brand} className="cat-brand">
              <button type="button" className="cat-brand-head" onClick={() => toggleBrand(b.brand)}>
                <span className="cat-chevron">{open[b.brand] ? "▾" : "▸"}</span>
                <strong>{b.brand}</strong>
                <span className="muted" style={{ fontSize: 13 }}>{b.count}</span>
              </button>
              {open[b.brand] && (
                <table>
                  <tbody>
                    {(byBrand[b.brand] || []).map((p) => (
                      <tr key={p.catalog_id}>
                        <td style={{ paddingLeft: 40, width: "34%" }}>{p.name}</td>
                        <td style={{ width: "14%" }}>{p.material}</td>
                        <td style={{ width: "26%" }}><span className="swatch" style={{ background: p.color_hex || "#666", marginRight: 6 }} />{p.color_name || "—"}</td>
                        <td className="muted" style={{ fontSize: 13 }}>{temps(p)}</td>
                        <td style={{ textAlign: "right", paddingRight: 16 }}>
                          <button className="secondary" title={t("Создать катушку из этой записи")} onClick={() => navigate("/spools/new", { state: { catalog: p } })}>{t("＋ В Мои катушки")}</button>
                        </td>
                      </tr>
                    ))}
                    {byBrand[b.brand] && byBrand[b.brand].length === 0 && (
                      <tr><td colSpan={5} className="muted" style={{ padding: 14, paddingLeft: 40 }}>{t("Нет данных")}</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {brands.length === 0 && <div className="muted" style={{ padding: 20 }}>{t("Загрузка…")}</div>}
          {brands.length > 0 && brandRows.length === 0 && <div className="muted" style={{ padding: 20 }}>{t("Ничего не найдено")}</div>}
        </div>
      )}
    </div>
  );
}
