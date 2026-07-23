import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import Icon from "../components/Icon.jsx";
import EnvSensor, { useEnvSensors } from "../components/EnvSensor.jsx";
import { buildTree, flattenTree, descendantIds } from "../utils/locations.js";

// «N внутри» с русским склонением — родитель показывает, что в нём что-то есть.
function insideLabel(n) {
  const mod10 = n % 10, mod100 = n % 100;
  let word = t("мест");
  if (mod10 === 1 && mod100 !== 11) word = t("место");
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = t("места");
  return `${n} ${word}`;
}

export default function Locations() {
  const [locations, setLocations] = useState([]);
  // Форма добавления и инлайн-правка держат раздельные состояния — иначе правка
  // «протекает» в поля добавления (одни и те же значения на две формы).
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [collapsed, setCollapsed] = useState(new Set());
  const { sensors, humidity_alert_max_pct: humidityMax } = useEnvSensors();
  const sensorFor = (locationId) =>
    sensors.find((s) => s.bind_type === "location" && s.bind_id === locationId);

  const tree = buildTree(locations);
  const flat = flattenTree(locations); // для селектов «Внутри» (плоский, с отступами)
  const childCount = (id) => locations.filter((l) => l.parent_id === id).length;
  const blocked = editId ? descendantIds(locations, editId) : new Set();
  const editParentOptions = flat.filter((l) => l.id !== editId && !blocked.has(l.id));

  function load() {
    api.get("/api/locations").then(setLocations).catch(() => {});
  }
  useEffect(load, []);

  function toggle(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function create(e) {
    e.preventDefault();
    if (!name) return;
    try {
      await api.post("/api/locations", { name, parent_id: parentId || null, description: description || null });
    } catch (err) {
      alert(err?.message || t("Не удалось сохранить"));
      return;
    }
    setName("");
    setParentId("");
    setDescription("");
    load();
  }

  function startEdit(l) {
    setEditId(l.id);
    setEditName(l.name);
    setEditParent(l.parent_id || "");
    setEditDesc(l.description || "");
  }
  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editName) return;
    try {
      await api.patch(`/api/locations/${editId}`, {
        name: editName,
        parent_id: editParent || null,
        description: editDesc || null,
      });
    } catch (err) {
      alert(err?.message || t("Не удалось сохранить"));
      return;
    }
    setEditId(null);
    load();
  }

  async function remove(id) {
    if (childCount(id) > 0) {
      alert(t("Нельзя удалить место, у которого есть вложенные — сначала уберите их"));
      return;
    }
    try {
      await api.del(`/api/locations/${id}`);
    } catch (err) {
      alert(err?.message || t("Не удалось удалить"));
    }
    if (editId === id) setEditId(null);
    load();
  }

  function renderNode(node) {
    const kids = node.children.length;
    const open = !collapsed.has(node.id);
    const sensor = sensorFor(node.id);
    const editing = editId === node.id;
    return (
      <li key={node.id} className="loc-node">
        <div className={`loc-row${editing ? " is-editing" : ""}`}>
          {editing ? (
            <form className="loc-edit" onSubmit={saveEdit}>
              <div className="row">
                <div><label>{t("Название")}</label><input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                <div>
                  <label>{t("Внутри")}</label>
                  <select value={editParent} onChange={(e) => setEditParent(e.target.value)}>
                    <option value="">{t("— Верхний уровень")}</option>
                    {editParentOptions.map((o) => (
                      <option key={o.id} value={o.id}>{"  ".repeat(o.depth) + o.name}</option>
                    ))}
                  </select>
                </div>
                <div><label>{t("Описание")}</label><input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /></div>
              </div>
              <div className="loc-edit-actions">
                <button>{t("Сохранить")}</button>
                <button type="button" className="secondary" onClick={cancelEdit}>{t("Отменить")}</button>
              </div>
            </form>
          ) : (
            <>
              {kids > 0 ? (
                <button
                  type="button"
                  className={`loc-twist${open ? " open" : ""}`}
                  onClick={() => toggle(node.id)}
                  aria-label={open ? t("Свернуть") : t("Развернуть")}
                  aria-expanded={open}
                >
                  <Icon name="chevron" size={16} />
                </button>
              ) : (
                <span className="loc-twist leaf" aria-hidden="true" />
              )}
              <div className="loc-main">
                <div className="loc-title">
                  <span className="loc-name">{node.name}</span>
                  {kids > 0 && <span className="loc-count">{insideLabel(kids)}</span>}
                </div>
                {(node.description || sensor) && (
                  <div className="loc-sub">
                    {node.description && <span className="loc-desc">{node.description}</span>}
                    {sensor && <EnvSensor sensor={sensor} threshold={humidityMax} showName={false} inline />}
                  </div>
                )}
              </div>
              <div className="loc-actions">
                <button className="icon-btn" onClick={() => startEdit(node)} title={t("Изменить")} aria-label={t("Изменить")}>
                  <Icon name="pencil" size={15} />
                </button>
                <button
                  className="icon-btn danger"
                  disabled={kids > 0}
                  onClick={() => remove(node.id)}
                  title={kids > 0 ? t("Нельзя удалить место, у которого есть вложенные — сначала уберите их") : t("Удалить")}
                  aria-label={t("Удалить")}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </>
          )}
        </div>
        {kids > 0 && open && <ul className="loc-children">{node.children.map(renderNode)}</ul>}
      </li>
    );
  }

  return (
    <div>
      <h2>{t("Места хранения")}</h2>
      <form className="card" onSubmit={create}>
        <div className="row">
          <div><label>{t("Название")}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Стеллаж, полка, сухобокс…")} /></div>
          <div>
            <label>{t("Внутри")}</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t("— Верхний уровень")}</option>
              {flat.map((l) => (
                <option key={l.id} value={l.id}>{"  ".repeat(l.depth) + l.name}</option>
              ))}
            </select>
          </div>
          <div><label>{t("Описание")}</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <button style={{ marginTop: 12 }}>{t("Добавить")}</button>
      </form>

      <div className="card">
        {tree.length === 0 ? (
          <div className="loc-empty">
            <Icon name="box" size={26} />
            <div>{t("Пока нет мест хранения")}</div>
            <div className="muted">{t("Добавьте первое — комнату, стеллаж или сухобокс, — а потом вкладывайте полки внутрь.")}</div>
          </div>
        ) : (
          <ul className="loc-tree">{tree.map(renderNode)}</ul>
        )}
      </div>
    </div>
  );
}
