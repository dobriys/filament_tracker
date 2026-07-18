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
    error_logging: false,
    telegram_enabled: false,
    telegram_chat_id: "",
    telegram_token_set: false,
    telegram_events: {},
    spool_low_threshold_g: 100,
  });
  const [log, setLog] = useState(null); // null = не загружен, {entries,total} = загружен
  const [logFilter, setLogFilter] = useState({ level: "", source: "", q: "" });
  const [msg, setMsg] = useState(null);
  const [serverVersion, setServerVersion] = useState(null);
  const [spoolmanUrl, setSpoolmanUrl] = useState("");
  const [spoolmanBusy, setSpoolmanBusy] = useState(false);
  const [catalogInfo, setCatalogInfo] = useState(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  // Токен не приходит с сервера — поле пустое, пока пользователь не введёт новый.
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState("");
  const [tgLow, setTgLow] = useState("");
  const [tgBusy, setTgBusy] = useState(false);
  // Свой статус рядом с кнопками: общий msg рисуется вверху страницы, а карточка
  // Telegram далеко внизу — результат «Отправить тест» туда просто не видно.
  const [tgMsg, setTgMsg] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    api.get("/api/settings").then((v) => {
      setS(v);
      setTgChat(v.telegram_chat_id || "");
      setTgLow(String(v.spool_low_threshold_g ?? 100));
    }).catch(() => {});
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

  // Типы уведомлений: ключ совпадает с notifications.EVENTS на бэкенде.
  const TG_EVENTS = [
    ["print_finished", t("Печать завершена")],
    ["print_error", t("Ошибка печати")],
    ["print_paused", t("Печать на паузе")],
    ["print_started", t("Печать началась")],
    ["print_cancelled", t("Печать отменена")],
    ["dryer_started", t("Сушка включена")],
    ["dryer_finished", t("Сушка завершена")],
    ["printer_offline", t("Принтер недоступен / снова на связи")],
    ["consume_failed", t("Автосписание не выполнено")],
    ["spool_low", t("Катушка заканчивается")],
  ];

  async function saveTelegram(patch) {
    setMsg(null);
    setTgMsg(null);
    try {
      setS(await api.put("/api/settings", patch));
      setMsg(t("Настройка сохранена"));
      setTgMsg({ ok: true, text: t("Настройка сохранена") });
      return true;
    } catch (err) {
      setMsg(err.message);
      setTgMsg({ ok: false, text: err.message });
      return false;
    }
  }

  function toggleEvent(key) {
    return (e) => saveTelegram({ telegram_events: { [key]: e.target.checked } });
  }

  async function saveTelegramBot() {
    const patch = { telegram_chat_id: tgChat.trim() };
    // Пустое поле токена = «не менять»; стереть можно кнопкой ниже.
    if (tgToken.trim()) patch.telegram_bot_token = tgToken.trim();
    const low = Number(tgLow);
    if (low > 0) patch.spool_low_threshold_g = low;
    setTgBusy(true);
    if (await saveTelegram(patch)) setTgToken("");
    setTgBusy(false);
  }

  async function detectChat() {
    setMsg(null);
    setTgMsg(null);
    setTgBusy(true);
    try {
      const r = await api.post("/api/settings/telegram/detect-chat");
      const chats = r.chats || [];
      // Обычно боту пишет один человек — он и подставляется сразу.
      setTgChat(chats[0].chat_id);
      setTgMsg({
        ok: true,
        text: chats.length === 1
          ? `${t("Найден chat id:")} ${chats[0].title}. ${t("Нажмите «Сохранить».")}`
          : `${t("Найдено несколько чатов, подставлен первый:")} ${chats.map((c) => c.title).join(", ")}`,
      });
    } catch (err) {
      setTgMsg({ ok: false, text: err.message });
    }
    setTgBusy(false);
  }

  async function testTelegram() {
    setMsg(null);
    setTgMsg(null);
    setTgBusy(true);
    try {
      await api.post("/api/settings/telegram/test");
      setTgMsg({ ok: true, text: t("Тестовое сообщение отправлено") });
    } catch (err) {
      setTgMsg({ ok: false, text: err.message });
    }
    setTgBusy(false);
  }

  async function loadLog(f = logFilter) {
    setMsg(null);
    const qs = new URLSearchParams();
    if (f.level) qs.set("level", f.level);
    if (f.source) qs.set("source", f.source);
    if (f.q) qs.set("q", f.q);
    qs.set("limit", "200");
    try {
      const r = await api.get(`/api/diagnostics/log?${qs.toString()}`);
      setLog(r);
    } catch (err) { setMsg(err.message); }
  }
  async function clearLog() {
    setMsg(null);
    try {
      await api.post("/api/diagnostics/clear");
      setLog({ entries: [], total: 0 });
      setMsg(t("Журнал очищен"));
    } catch (err) { setMsg(err.message); }
  }
  function downloadLog() {
    api.download("/api/diagnostics/log.txt", { filename: "filament-tracker-diagnostics.txt" })
      .catch((e) => setMsg(e.message));
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
    if (!window.confirm(t("Восстановить из файла? Ваши катушки, профили, места, принтеры и история печати будут удалены и заменены данными из файла. Необратимо."))) {
      e.target.value = "";
      return;
    }
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
        <p className="muted">{t("Экспорт всех ваших данных в JSON и восстановление из файла (данные заменяются: текущие удаляются).")}</p>
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

      <div className="card">
        <h3>{t("Уведомления в Telegram")}</h3>
        <p className="muted">
          {t("Сообщения об изменениях состояния принтера: печать завершена, ошибка, сушка и т.д. Создайте бота через @BotFather, получите токен, напишите боту и укажите chat id (узнать можно у @userinfobot).")}
        </p>
        {!isAdmin && <div className="muted">{t("Доступно только администратору.")}</div>}
        {isAdmin && (
          <>
            <Toggle
              k="telegram_enabled"
              label={t("Отправлять уведомления")}
              hint={t("Общий выключатель: пока выключен, ничего не отправляется и принтеры не опрашиваются ради уведомлений.")}
            />
            <div style={{ display: "grid", gap: 8, maxWidth: 420, marginTop: 12 }}>
              <label>
                {t("Токен бота")}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={tgToken}
                  onChange={(e) => setTgToken(e.target.value)}
                  placeholder={s.telegram_token_set ? t("Токен сохранён — введите новый, чтобы заменить") : "123456:ABC-DEF..."}
                />
              </label>
              <label>
                {t("Chat id")}
                <input
                  value={tgChat}
                  onChange={(e) => setTgChat(e.target.value)}
                  placeholder="123456789"
                />
              </label>
              <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                {t("Напишите боту «/start» и нажмите «Определить chat id» — вводить вручную не нужно.")}
              </div>
              <label>
                {t("Порог «катушка заканчивается», г")}
                <input
                  type="number"
                  min="1"
                  value={tgLow}
                  onChange={(e) => setTgLow(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="secondary" onClick={saveTelegramBot} disabled={tgBusy}>
                  {t("Сохранить")}
                </button>
                <button
                  className="secondary"
                  onClick={detectChat}
                  disabled={tgBusy || !s.telegram_token_set}
                  title={t("Определить по тем, кто написал боту")}
                >
                  {t("Определить chat id")}
                </button>
                <button
                  className="secondary"
                  onClick={testTelegram}
                  disabled={tgBusy || !s.telegram_token_set || !s.telegram_chat_id}
                >
                  {t("Отправить тест")}
                </button>
              </div>
              {tgMsg && (
                <div className={tgMsg.ok ? "muted" : "error"} style={{ fontSize: 13 }}>
                  {tgMsg.text}
                </div>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="card-sub" style={{ marginBottom: 8 }}>{t("Что отправлять")}</div>
              {TG_EVENTS.map(([key, label]) => (
                <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={!!s.telegram_events?.[key]}
                    onChange={toggleEvent(key)}
                    disabled={!s.telegram_enabled}
                  />
                  {label}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>{t("Диагностический журнал")}</h3>
        <p className="muted">
          {t("Для отладки: включите запись, повторите проблемные действия, затем скачайте журнал и приложите его к issue на GitHub. Пишутся действия (запросы к серверу с результатом), автоматизация принтера (импорт, автосписание, сушка) и ошибки — бэкенда и браузера. Хранится в базе (последние 5000 записей).")}
        </p>
        <Toggle
          k="error_logging"
          label={t("Записывать действия и ошибки")}
          hint={t("Личных данных в записях обычно нет, но перед публикацией просмотрите журнал: секреты (пароли, ключи) вырезаются автоматически.")}
        />
        {!isAdmin && <div className="muted" style={{ marginTop: 6 }}>{t("Доступно только администратору.")}</div>}
        {isAdmin && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              <select
                style={{ width: "auto" }}
                value={logFilter.level}
                onChange={(e) => { const f = { ...logFilter, level: e.target.value }; setLogFilter(f); loadLog(f); }}
              >
                <option value="">{t("Все уровни")}</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
              <select
                style={{ width: "auto" }}
                value={logFilter.source}
                onChange={(e) => { const f = { ...logFilter, source: e.target.value }; setLogFilter(f); loadLog(f); }}
              >
                <option value="">{t("Все источники")}</option>
                <option value="http">http</option>
                <option value="poller">poller</option>
                <option value="backend">backend</option>
                <option value="frontend">frontend</option>
              </select>
              <input
                style={{ flex: "1 1 160px" }}
                placeholder={t("Поиск по тексту/пути")}
                value={logFilter.q}
                onChange={(e) => setLogFilter({ ...logFilter, q: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") loadLog(); }}
              />
              <button className="secondary" onClick={() => loadLog()}>{t("Показать")}</button>
              <button className="secondary" onClick={downloadLog}>{t("Скачать (.txt)")}</button>
              <button className="secondary" onClick={clearLog}>{t("Очистить")}</button>
            </div>
            {log !== null && (
              log.entries.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>{t("Журнал пуст.")}</div>
              ) : (
                <>
                  <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                    {t("Показано")} {log.entries.length} {t("из")} {log.total}
                  </div>
                  <div style={{
                    marginTop: 6, maxHeight: 360, overflow: "auto", fontSize: 12,
                    background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6,
                  }}>
                    {log.entries.map((e) => (
                      <div key={e.id} style={{ padding: "6px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span className="badge" style={{
                            background: `var(--badge-${e.level === "error" ? "danger" : e.level === "warning" ? "warn" : "info"}-bg)`,
                            color: `var(--badge-${e.level === "error" ? "danger" : e.level === "warning" ? "warn" : "info"}-text)`,
                          }}>{e.level}</span>
                          <span className="mono muted">{e.time}</span>
                          <span className="mono">{e.source}</span>
                          {e.status != null && <span className="mono muted">{e.status}</span>}
                          {e.duration_ms != null && <span className="mono muted">{e.duration_ms}ms</span>}
                        </div>
                        <div className="mono" style={{ marginTop: 2 }}>
                          {e.action || `${e.method || ""} ${e.path || ""}`}
                        </div>
                        {e.message && <div style={{ marginTop: 2 }}>{e.message}</div>}
                        {e.context && (
                          <details style={{ marginTop: 2 }}>
                            <summary className="muted" style={{ cursor: "pointer" }}>{t("подробнее")}</summary>
                            <pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontSize: 11 }}>
                              {JSON.stringify(e.context, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        Filament Tracker · {t("интерфейс")} <span className="mono">{window.__FT_CONFIG__?.version || "dev"}</span>
        {serverVersion && <> · {t("сервер")} <span className="mono">{serverVersion}</span></>}
      </div>
    </div>
  );
}
