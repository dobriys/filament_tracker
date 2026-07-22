import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import EnvSensor, { useEnvSensors } from "../components/EnvSensor.jsx";
import { flattenTree, descendantIds } from "../utils/locations.js";

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [editId, setEditId] = useState(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const { sensors, humidity_alert_max_pct: humidityMax } = useEnvSensors();
  const sensorFor = (locationId) =>
    sensors.find((s) => s.bind_type === "location" && s.bind_id === locationId);

  const tree = flattenTree(locations);
  const childCount = (id) => locations.filter((l) => l.parent_id === id).length;
  // При редактировании исключаем сам узел и его потомков — иначе получится цикл.
  const blocked = editId ? descendantIds(locations, editId) : new Set();
  const parentOptions = tree.filter((l) => l.id !== editId && !blocked.has(l.id));

  function load() {
    api.get("/api/locations").then(setLocations).catch(() => {});
  }
  useEffect(load, []);

  function resetForm() {
    setEditId(null);
    setName("");
    setParentId("");
    setDescription("");
  }

  function startEdit(l) {
    setEditId(l.id);
    setName(l.name);
    setParentId(l.parent_id || "");
    setDescription(l.description || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e) {
    e.preventDefault();
    if (!name) return;
    const payload = { name, parent_id: parentId || null, description: description || null };
    try {
      if (editId) await api.patch(`/api/locations/${editId}`, payload);
      else await api.post("/api/locations", payload);
    } catch (err) {
      alert(err?.message || t("Не удалось сохранить"));
      return;
    }
    resetForm();
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
    if (editId === id) resetForm();
    load();
  }

  return (
    <div>
      <h2>{t("Места хранения")}</h2>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <div><label>{t("Название")}</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <label>{t("Внутри")}</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t("— Верхний уровень")}</option>
              {parentOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {"  ".repeat(l.depth) + l.name}
                </option>
              ))}
            </select>
          </div>
          <div><label>{t("Описание")}</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button>{editId ? t("Сохранить") : t("Добавить")}</button>
          {editId && <button type="button" className="secondary" onClick={resetForm}>{t("Отмена")}</button>}
        </div>
      </form>

      <div className="card">
        <table className="cards-mobile">
          <thead><tr>
            <th>{t("Название")}</th>
            <th>{t("Описание")}</th>
            {/* Колонка появляется, только когда к местам привязан хоть один датчик. */}
            {sensors.length > 0 && <th>{t("Условия")}</th>}
            <th></th>
          </tr></thead>
          <tbody>
            {tree.map((l) => (
              <tr key={l.id} className={editId === l.id ? "row-active" : ""}>
                <td data-label={t("Название")}>
                  <span style={{ paddingLeft: l.depth * 20 }}>
                    {l.depth > 0 && <span className="muted">└ </span>}
                    {l.name}
                  </span>
                </td>
                <td data-label={t("Описание")} className="muted">{l.description || ""}</td>
                {sensors.length > 0 && (
                  <td data-label={t("Условия")}>
                    {sensorFor(l.id)
                      ? <EnvSensor sensor={sensorFor(l.id)} threshold={humidityMax} showName={false} inline />
                      : <span className="muted">—</span>}
                  </td>
                )}
                <td data-label="">
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="secondary" onClick={() => startEdit(l)}>{t("Изменить")}</button>
                    <button
                      className="danger"
                      disabled={childCount(l.id) > 0}
                      title={childCount(l.id) > 0 ? t("Нельзя удалить место, у которого есть вложенные — сначала уберите их") : ""}
                      onClick={() => remove(l.id)}
                    >
                      {t("Удалить")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {locations.length === 0 && <tr><td colSpan={sensors.length > 0 ? 4 : 3} className="muted">{t("Пока нет мест хранения")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
