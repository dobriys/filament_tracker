import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../api/auth.jsx";
import { t } from "../i18n.js";

export default function Profiles() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);
  const fileRef = useRef();

  function load() {
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
  }
  useEffect(load, []);

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
    // newColor: то же бренд/название/материал, цвет очищается — задать новый.
    const copy = await api.post(`/api/filament-profiles/${id}/duplicate${newColor ? "?new_color=true" : ""}`);
    navigate(`/profiles/${copy.id}/edit`);
  }
  async function remove(id) {
    await api.del(`/api/filament-profiles/${id}`);
    load();
  }

  // Показываем только свои профили (каталог используется для предзаполнения катушки).
  const rows = profiles.filter((p) => {
    if (p.owner_user_id !== user?.id) return false;
    if (!q) return true;
    return `${p.brand} ${p.name} ${p.material} ${p.color_name}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{t("Профили филамента")}</h2>
          <div className="muted">{t("Свои настройки печати на каждый бренд/материал/цвет.")}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" title={t("Профиль слайсера Bambu Studio / OrcaSlicer (.json)")} onClick={() => fileRef.current.click()}>{t("Импорт из слайсера (JSON)")}</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={importSlicer} />
          <button onClick={() => navigate("/profiles/new")}>{t("+ Добавить")}</button>
        </div>
      </div>
      {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}

      <div className="inv-toolbar" style={{ marginTop: 14 }}>
        <input className="inv-search" placeholder={t("🔍 Поиск по бренду, материалу, цвету…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th style={{ paddingLeft: 16 }}>{t("Бренд")}</th><th>{t("Название")}</th><th>{t("Материал")}</th><th>{t("Цвет")}</th><th>{t("Сопло / Стол")}</th><th>{t("Действия")}</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const nozzle = p.nozzle_temp_max ? `${p.nozzle_temp_min || ""}${p.nozzle_temp_min ? "–" : ""}${p.nozzle_temp_max}°` : "—";
              const bed = p.bed_temp_max ? `${p.bed_temp_min || ""}${p.bed_temp_min ? "–" : ""}${p.bed_temp_max}°` : "—";
              return (
                <tr key={p.id}>
                  <td style={{ paddingLeft: 16 }}>{p.brand || "—"}</td>
                  <td>{p.name}</td>
                  <td>{p.material}</td>
                  <td>
                    <span className="swatch" style={{ background: p.color_hex || "#666", marginRight: 6 }} />
                    {p.color_name || "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{nozzle} / {bed}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button className="secondary" title={t("Создать катушку из этого профиля")} onClick={() => navigate(`/spools/new?profile=${p.id}`)}>{t("＋ В инвентарь")}</button>
                      <button className="icon-btn" title={t("Изменить")} onClick={() => navigate(`/profiles/${p.id}/edit`)}>✎</button>
                      <button className="icon-btn" title={t("Дублировать (новый цвет)")} onClick={() => duplicate(p.id, true)}>⧉</button>
                      <button className="icon-btn danger" title={t("Удалить")} onClick={() => remove(p.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>{t("Ничего не найдено")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
