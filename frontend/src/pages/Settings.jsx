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
  const [spoolmanUrl, setSpoolmanUrl] = useState("");
  const [spoolmanBusy, setSpoolmanBusy] = useState(false);
  const [catalogInfo, setCatalogInfo] = useState(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    api.get("/api/settings").then(setS).catch(() => {});
    api.get("/health").then((h) => setServerVersion(h.version)).catch(() => {});
    api.get("/api/filament-catalog/info").then(setCatalogInfo).catch(() => {});
  }, []);

  async function refreshCatalog() {
    setMsg(null);
    setCatalogBusy(true);
    try {
      const r = await api.post("/api/filament-catalog/refresh");
      setCatalogInfo(r);
      setMsg(`${t("Каталог филамента обновлён:")} ${r.count} ${t("записей")}`);
    } catch (err) { setMsg(err.message); }
    setCatalogBusy(false);
  }

  // Применяем ответ сервера (PUT возвращает полное состояние), а не оптимистично:
  // при ошибке состояние не меняется — переключатель сам «откатится».
  function toggle(key) {
    return async (e) => {
      const v = e.target.checked;
      try {
        setS(await api.put("/api/settings", { [key]: v }));
        setMsg(t("Настройка сохранена"));
      } catch (err) { setMsg(err.message); }
    };
  }

  // Режимы автоматизации Moonraker — единый выбор вместо двух чекбоксов.
  // Автосписание невозможно без автоимпорта, поэтому это одно состояние из трёх.
  const AUTO_MODES = [
    {
      key: "off",
      label: t("Выкл"),
      hint: t("Автоматизация отключена. Завершённые печати импортируете и списываете вручную."),
    },
    {
      key: "import",
      label: t("Автоимпорт"),
      hint: t("Фоновый опрос принтеров: новые завершённые печати сами появляются в истории черновиком — остаётся только списать материал."),
    },
    {
      key: "consume",
      label: t("Автосписание"),
      hint: t("Импорт и автоматическое списание материала, когда каждый инструмент печати сопоставлен со слотом принтера с катушкой. Если сопоставить не удалось — печать остаётся черновиком."),
    },
  ];
  const autoMode = !s.moonraker_auto_import ? "off" : s.moonraker_auto_consume ? "consume" : "import";

  async function setAutoMode(mode) {
    const patch = {
      moonraker_auto_import: mode !== "off",
      moonraker_auto_consume: mode === "consume",
    };
    try {
      setS(await api.put("/api/settings", patch));  // применяем ответ сервера
      setMsg(t("Настройка сохранена"));
    } catch (err) { setMsg(err.message); }
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

  async function importSpoolman() {
    const url = spoolmanUrl.trim();
    if (!url) return;
    setMsg(null);
    setSpoolmanBusy(true);
    try {
      const r = await api.post("/api/spools/import-spoolman", { url });
      setMsg(`${t("Импорт из Spoolman: добавлено")} ${r.imported}, ${t("пропущено")} ${r.skipped} ${t("из")} ${r.total}`);
    } catch (err) { setMsg(err.message); }
    setSpoolmanBusy(false);
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
        <h3>{t("Импорт из Spoolman")}</h3>
        <p className="muted">{t("Перенос катушек из вашего Spoolman по сети. Повторный импорт пропускает уже добавленные катушки.")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ flex: "1 1 260px" }}
            value={spoolmanUrl}
            onChange={(e) => setSpoolmanUrl(e.target.value)}
            placeholder="http://spoolman.local:7912"
          />
          <button className="secondary" onClick={importSpoolman} disabled={spoolmanBusy || !spoolmanUrl.trim()}>
            {spoolmanBusy ? t("Импорт…") : t("Импортировать")}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>{t("Каталог филамента (SpoolmanDB)")}</h3>
        <p className="muted">
          {t("Автозаполнение катушки по базе филаментов")}{" "}
          <a href="https://github.com/Donkie/SpoolmanDB" target="_blank" rel="noreferrer">SpoolmanDB</a>
          {catalogInfo?.count ? ` · ${catalogInfo.count} ${t("записей")}` : ""}.{" "}
          {t("Снапшот встроен и работает офлайн; кнопка ниже подтягивает свежую версию.")}
        </p>
        <button className="secondary" onClick={refreshCatalog} disabled={catalogBusy}>
          {catalogBusy ? t("Обновление…") : t("Обновить из SpoolmanDB")}
        </button>
      </div>

      <div className="card">
        <h3>{t("Moonraker: автоматизация")}</h3>
        <div className="card-sub" style={{ marginBottom: 12 }}>
          {t("Что приложение делает с завершёнными печатями с принтера.")}
        </div>
        <div className="seg-toggle" role="tablist" aria-label={t("Moonraker: автоматизация")}>
          {AUTO_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={autoMode === m.key}
              className={`seg-item ${autoMode === m.key ? "active" : ""}`}
              disabled={!isAdmin}
              onClick={() => setAutoMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="seg-hint">
          <b>{AUTO_MODES.find((m) => m.key === autoMode)?.label}.</b>{" "}
          {AUTO_MODES.find((m) => m.key === autoMode)?.hint}
        </div>
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
