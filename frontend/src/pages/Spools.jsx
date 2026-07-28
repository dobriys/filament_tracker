import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { MATERIALS } from "../specFields.js";
import { t } from "../i18n.js";
import Icon from "../components/Icon.jsx";
import { locationPath } from "../utils/locations.js";
import { spoolTitle } from "../utils/spools.js";

const STATUS_LABELS = {
  new: t("новая"),
  in_use: t("используется"),
  almost_empty: t("почти закончилась"),
  empty: t("закончилась"),
  archived: t("архив"),
};

export default function Spools() {
  const [spools, setSpools] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState({});
  // На узких экранах сетка (карточки) читается лучше «списка»-таблицы.
  const [view, setView] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "grid" : "list"
  );
  const [search, setSearch] = useState("");
  const [matFilter, setMatFilter] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [menu, setMenu] = useState(null);
  const [slotMap, setSlotMap] = useState({}); // spool_id -> "Printer / Slot N"
  const navigate = useNavigate();

  function load() {
    api.get("/api/spools").then(setSpools).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
    api.get("/api/locations").then(setLocations).catch(() => {});
    (async () => {
      const printers = await api.get("/api/printers").catch(() => []);
      const sm = {};
      for (const p of printers) {
        const slots = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        for (const s of slots) if (s.current_spool_id) sm[s.current_spool_id] = `${p.name} / ${s.name || "Slot " + s.slot_index}`;
      }
      setSlotMap(sm);
    })();
  }, []);

  const profMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const locMap = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations]);

  function enrich(s) {
    const p = profMap[s.filament_profile_id];
    const remaining = Number(s.current_weight_g);
    const capacity = Number(s.initial_filament_weight_g) || 1000;
    const pct = Math.max(0, Math.min(1, remaining / capacity));
    const low = s.status === "almost_empty" || s.status === "empty" || pct < 0.15;
    const brand = s.manufacturer || p?.brand;
    const name = p?.name || s.label;
    const dia = s.diameter_mm || p?.diameter_mm;
    return {
      p, remaining, pct, low, photo: s.photo,
      title: spoolTitle(brand, name),
      sku: s.sku || s.label || "",
      material: s.material || p?.material || "—",
      colorName: s.color_name || p?.color_name || "",
      colorHex: s.color_hex || p?.color_hex,
      diameter: dia ? `${Number(dia)}mm` : "—",
      locName: s.location_id ? locMap[s.location_id]?.name : null,
      slotLabel: slotMap[s.id] || null,
    };
  }

  const rows = useMemo(() => {
    return spools
      .map((s) => ({ s, e: enrich(s) }))
      .filter(({ s, e }) => {
        // По умолчанию скрываем архив; показываем, только если выбран статус «архив».
        if (!statusFilter && s.status === "archived") return false;
        if (matFilter && e.material !== matFilter) return false;
        if (locFilter && s.location_id !== locFilter) return false;
        if (statusFilter && s.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!`${e.title} ${e.sku} ${e.material} ${e.colorName}`.toLowerCase().includes(q)) return false;
        }
        return true;
      });
  }, [spools, profMap, locMap, slotMap, matFilter, locFilter, statusFilter, search]);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allVisibleSelected = rows.length > 0 && rows.every(({ s }) => selected[s.id]);
  function toggleAll() {
    const next = { ...selected };
    const v = !allVisibleSelected;
    rows.forEach(({ s }) => { next[s.id] = v; });
    setSelected(next);
  }
  async function printA4() {
    await api.download("/api/spools/labels.pdf", {
      method: "POST", body: { spool_ids: selectedIds, format: "card" }, filename: "labels-a4.pdf",
    });
  }
  async function archive(id) {
    setMenu(null);
    await api.patch(`/api/spools/${id}`, { status: "archived" });
    load();
  }
  async function unarchive(id) {
    setMenu(null);
    await api.patch(`/api/spools/${id}`, { status: "in_use" });
    load();
  }
  async function duplicate(id) {
    setMenu(null);
    const copy = await api.post(`/api/spools/${id}/duplicate?new_color=true`);
    navigate(`/spools/${copy.id}/edit`);
  }
  async function deleteSpool(id) {
    setMenu(null);
    if (!window.confirm(t("Удалить катушку? Действие необратимо (история списаний по ней тоже удалится)."))) return;
    await api.del(`/api/spools/${id}`);
    load();
  }
  async function bulkArchive() {
    await Promise.all(selectedIds.map((id) => api.patch(`/api/spools/${id}`, { status: "archived" })));
    setSelected({}); load();
  }
  async function bulkDelete() {
    if (!window.confirm(`${t("Удалить выбранные катушки")} (${selectedIds.length})? ${t("Необратимо.")}`)) return;
    await Promise.all(selectedIds.map((id) => api.del(`/api/spools/${id}`)));
    setSelected({}); load();
  }

  // Шкала остатка окрашена самим филаментом: полоса показывает, сколько
  // осталось именно этого цвета. На критическом и низком остатке цвет
  // перебивается статусным — тревога должна читаться раньше материала.
  const barColor = (e) => {
    if (e.pct <= 0.1 || e.low) return "var(--danger)";
    if (e.pct <= 0.25) return "var(--warn)";
    return e.colorHex || "var(--muted-2)";
  };

  return (
    <div onClick={() => setMenu(null)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{t("Катушки")}</h2>
          <div className="muted">{t("Управление катушками и отслеживание остатка.")}</div>
        </div>
        <button onClick={() => navigate("/spools/new")}><Icon name="plus" /> {t("Добавить катушку")}</button>
      </div>

      {/* Тулбар */}
      <div className="inv-toolbar" style={{ marginTop: 16 }}>
        <input className="inv-search" placeholder={t("Поиск по названию или метке…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-chip" value={matFilter} onChange={(e) => setMatFilter(e.target.value)}>
          <option value="">{t("Материал: все")}</option>
          {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="filter-chip" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
          <option value="">{t("Место: все")}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{locationPath(locations, l.id)}</option>)}
        </select>
        <select className="filter-chip" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t("Статус: активные")}</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {selectedIds.length > 0 && (
            <>
              <span className="muted" style={{ fontSize: "var(--fs-3)" }}>{t("Выбрано:")}{" "}{selectedIds.length}</span>
              <button className="secondary" onClick={printA4}>{t("Печать A4")}</button>
              <button className="secondary" onClick={bulkArchive}>{t("В архив")}</button>
              <button className="danger" onClick={bulkDelete}>{t("Удалить")}</button>
            </>
          )}
          <div className="seg">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><Icon name="list" size={15} /> {t("Список")}</button>
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Icon name="grid" size={15} /> {t("Сетка")}</button>
          </div>
        </div>
      </div>

      {view === "list" ? (
        <div className="card" style={{ padding: 0, overflow: "visible" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36, paddingLeft: 16 }}><input type="checkbox" style={{ width: "auto" }} checked={allVisibleSelected} onChange={toggleAll} /></th>
                <th>{t("Катушка")}</th>
                <th>{t("Материал")}</th>
                <th>{t("Цвет")}</th>
                <th>RGB</th>
                <th>{t("Где находится")}</th>
                <th style={{ width: 200 }}>{t("Остаток")}</th>
                <th style={{ width: 90 }}>{t("Действия")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, e }) => (
                <tr key={s.id} className="inv-row" style={{ "--fil": e.colorHex || "var(--border)" }}>
                  {/* Полоса реального цвета филамента по левому краю строки —
                      по ней полку с катушками читают так же, как в жизни. */}
                  <td className="fil-edge" style={{ paddingLeft: 16 }}><input type="checkbox" style={{ width: "auto" }} checked={!!selected[s.id]} onChange={(ev) => setSelected({ ...selected, [s.id]: ev.target.checked })} /></td>
                  <td>
                    <Link to={`/spools/${s.id}`}>{e.title}</Link>
                  </td>
                  <td><span className="mat-pill">{e.material}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="swatch" style={{ background: e.colorHex || "var(--muted)" }} />
                      <span style={{ fontSize: "var(--fs-3)" }}>{e.colorName || "—"}</span>
                    </div>
                  </td>
                  <td className="muted mono" style={{ fontSize: "var(--fs-3)" }}>{e.colorHex || "—"}</td>
                  <td style={{ fontSize: "var(--fs-3)" }}>
                    {e.slotLabel
                      ? <span className="badge in_use"><Icon name="printer" size={13} /> {e.slotLabel}</span>
                      : e.locName
                      ? <span className="inline-ico"><Icon name="pin" size={14} /> {e.locName}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-3)" }}>
                      <span className="mono">{e.remaining.toFixed(0)}{" "}{t("г")}</span>
                      <span className="muted mono">{Math.round(e.pct * 100)}%</span>
                    </div>
                    <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${Math.round(e.pct * 100)}%`, background: barColor(e) }} /></div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }} onClick={(ev) => ev.stopPropagation()}>
                      <button className="icon-btn" title={t("Редактировать")} onClick={() => navigate(`/spools/${s.id}/edit`)}><Icon name="pencil" /></button>
                      <div className="kebab-wrap">
                        <button className="icon-btn" title={t("Ещё")} onClick={(ev) => { ev.stopPropagation(); setMenu(menu === s.id ? null : s.id); }}>⋮</button>
                        {menu === s.id && (
                          <div className="kebab-menu" onClick={(ev) => ev.stopPropagation()}>
                            <button onClick={() => duplicate(s.id)}>{t("Дублировать (новый цвет)")}</button>
                            {s.status === "archived"
                              ? <button onClick={() => unarchive(s.id)}>{t("Из архива")}</button>
                              : <button onClick={() => archive(s.id)}>{t("В архив")}</button>}
                            <button onClick={() => deleteSpool(s.id)}>{t("Удалить")}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>{t("Ничего не найдено")}</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="inv-grid">
          {rows.map(({ s, e }) => (
            <div key={s.id} className="card spool-card" style={{ "--fil": e.colorHex || "var(--border)" }} onClick={() => navigate(`/spools/${s.id}`)}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!selected[s.id]} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => setSelected({ ...selected, [s.id]: ev.target.checked })} />
              </div>
              <div style={{ fontWeight: 600 }}>{e.title}</div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <span className="mat-pill">{e.material}</span>
                <span className="swatch" style={{ background: e.colorHex || "var(--muted)" }} />
                <span style={{ fontSize: "var(--fs-3)" }}>{e.colorName}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: "var(--fs-2)" }}>
                {e.slotLabel
                  ? <span className="badge in_use"><Icon name="printer" size={13} /> {e.slotLabel}</span>
                  : e.locName
                  ? <span className="muted inline-ico"><Icon name="pin" size={14} /> {e.locName}</span>
                  : <span className="muted inline-ico"><Icon name="pin" size={14} /> {t("не указано")}</span>}
              </div>
              <div style={{ marginTop: "auto", paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: "var(--fs-3)" }}>
                <span className="mono">{e.remaining.toFixed(0)}{" "}{t("г")}</span><span className="muted mono">{Math.round(e.pct * 100)}%</span>
              </div>
              <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${Math.round(e.pct * 100)}%`, background: barColor(e) }} /></div>
            </div>
          ))}
          {rows.length === 0 && <div className="muted">{t("Ничего не найдено")}</div>}
        </div>
      )}
    </div>
  );
}
