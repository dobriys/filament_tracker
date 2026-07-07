import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function load() {
    api.get("/api/locations").then(setLocations).catch(() => {});
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    if (!name) return;
    await api.post("/api/locations", { name, description: description || null });
    setName("");
    setDescription("");
    load();
  }

  async function remove(id) {
    await api.del(`/api/locations/${id}`);
    load();
  }

  return (
    <div>
      <h2>{t("Места хранения")}</h2>
      <form className="card" onSubmit={create}>
        <div className="row">
          <div><label>{t("Название")}</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>{t("Описание")}</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <button style={{ marginTop: 12 }}>{t("Добавить")}</button>
      </form>

      <div className="card">
        <table className="cards-mobile">
          <thead><tr><th>{t("Название")}</th><th>{t("Описание")}</th><th></th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id}>
                <td data-label={t("Название")}>{l.name}</td>
                <td data-label={t("Описание")} className="muted">{l.description || ""}</td>
                <td data-label=""><button className="danger" onClick={() => remove(l.id)}>{t("Удалить")}</button></td>
              </tr>
            ))}
            {locations.length === 0 && <tr><td colSpan={3} className="muted">{t("Пока нет мест хранения")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
