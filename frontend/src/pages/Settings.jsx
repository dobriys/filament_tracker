import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/auth.jsx";
import { t } from "../i18n.js";

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [s, setS] = useState({
    allow_negative_consumption: false,
    moonraker_auto_import: true,
    moonraker_auto_consume: false,
  });
  const [msg, setMsg] = useState(null);
  const [serverVersion, setServerVersion] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    api.get("/api/settings").then(setS).catch(() => {});
    api.get("/health").then((h) => setServerVersion(h.version)).catch(() => {});
  }, []);

  function toggle(key) {
    return async (e) => {
      const v = e.target.checked;
      setS((prev) => ({ ...prev, [key]: v }));
      try {
        await api.put("/api/settings", { [key]: v });
        setMsg(t("Настройка сохранена"));
      } catch (err) { setMsg(err.message); }
    };
  }

  function Toggle({ k, label, hint }) {
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={s[k]}
            onChange={toggle(k)}
            disabled={!isAdmin}
          />
          {label}
        </label>
        {hint && <div className="muted" style={{ marginLeft: 24, fontSize: 13 }}>{hint}</div>}
      </div>
    );
  }

  function exportBackup() {
    api.download("/api/backup/export", { filename: "filament-backup.json" }).catch((e) => setMsg(e.message));
  }
  async function importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    try {
      const res = await api.postFile("/api/backup/import", file);
      setMsg(`${t("Восстановлено: профили")} ${res.filament_profiles}, ${t("катушки")} ${res.spools}, ${t("места")} ${res.locations}, ${t("принтеры")} ${res.printers}, ${t("печати")} ${res.print_jobs ?? 0}`);
    } catch (err) { setMsg(err.message); }
    e.target.value = "";
  }

  return (
    <div>
      <h2>{t("Настройки")}</h2>
      {msg && <div className="muted" style={{ marginBottom: 8 }}>{msg}</div>}

      <div className="card">
        <h3>{t("Бэкап")}</h3>
        <p className="muted">{t("Экспорт всех ваших данных в JSON и восстановление из файла (данные добавляются, не перезаписываются).")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={exportBackup}>{t("Скачать бэкап (JSON)")}</button>
          <button className="secondary" onClick={() => fileRef.current.click()}>{t("Восстановить из файла")}</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={importBackup} />
        </div>
      </div>

      <div className="card">
        <h3>{t("Moonraker: автоматизация")}</h3>
        <Toggle
          k="moonraker_auto_import"
          label={t("Автоимпорт завершённых печатей")}
          hint={t("Фоновый опрос принтеров: новые завершённые задания появляются в истории сами (черновиком для списания).")}
        />
        <Toggle
          k="moonraker_auto_consume"
          label={t("Автосписание материала")}
          hint={t("Списывать без подтверждения, если каждый инструмент печати сопоставлен со слотом принтера и в слоте стоит катушка. Иначе печать останется черновиком.")}
        />
        {!isAdmin && <div className="muted" style={{ marginTop: 6 }}>{t("Доступно только администратору.")}</div>}
      </div>

      <div className="card">
        <h3>{t("Списание")}</h3>
        <Toggle
          k="allow_negative_consumption"
          label={t("Разрешить списание катушки в минус при нехватке остатка")}
        />
        {!isAdmin && <div className="muted" style={{ marginTop: 6 }}>{t("Доступно только администратору.")}</div>}
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        Filament Tracker · {t("интерфейс")} <span className="mono">{window.__FT_CONFIG__?.version || "dev"}</span>
        {serverVersion && <> · {t("сервер")} <span className="mono">{serverVersion}</span></>}
      </div>
    </div>
  );
}
