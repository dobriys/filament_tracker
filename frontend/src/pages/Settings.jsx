import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/auth.jsx";
import { t } from "../i18n.js";
import { lowThresholdFor, setLowConfig } from "../utils/spools.js";
import Icon from "../components/Icon.jsx";

// ------------------------------------------------------------------
// Разделы настроек
//
// Порядок и группировка живут в одном месте: и боковое оглавление, и колонка
// с содержимым рисуются из GROUPS, поэтому разъехаться они не могут.
// Группы отвечают на разные вопросы: что приложение делает само, с чем оно
// связано снаружи и откуда берутся данные.
// ------------------------------------------------------------------
const SECTION_TITLES = {
  prints: t("Завершённые печати"),
  consumption: t("Списание"),
  low: t("Остаток филамента"),
  telegram: t("Уведомления в Telegram"),
  sensors: t("Датчики температуры и влажности"),
  catalog: t("Каталог филамента"),
  spoolman: t("Импорт из Spoolman"),
  backup: t("Бэкап"),
  journal: t("Диагностический журнал"),
};
const GROUPS = [
  { title: t("Автоматика"), ids: ["prints", "consumption", "low"] },
  { title: t("Подключения"), ids: ["telegram", "sensors"] },
  { title: t("Данные"), ids: ["catalog", "spoolman", "backup", "journal"] },
];
const SECTION_IDS = GROUPS.flatMap((g) => g.ids);

// Готовые ответы на вопрос «когда предупреждать, что катушка кончается».
// Рядовому пользователю не нужно знать про доли и границы — ему нужно выбрать,
// узнавать ли заранее. Точные числа остаются под «Настроить точнее».
const LOW_PRESETS = [
  { key: "early",  label: "Заранее",           hint: "успеть заказать замену", pct: 15, min_g: 80, max_g: 400 },
  { key: "normal", label: "Обычно",            hint: "рекомендуется",          pct: 10, min_g: 50, max_g: 200 },
  { key: "late",   label: "В самом конце",     hint: "меньше уведомлений",     pct: 5,  min_g: 40, max_g: 100 },
];

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
    spool_low_pct: 10,
    spool_low_min_g: 50,
    spool_low_max_g: 200,
    humidity_alert_max_pct: 45,
    ha_enabled: false,
    ha_base_url: "",
    ha_token_set: false,
    ha_sensors: [],
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
  // Порог «катушка заканчивается»: доля от ёмкости катушки и зажимы в граммах.
  const [lowPct, setLowPct] = useState("");
  const [lowMin, setLowMin] = useState("");
  const [lowMax, setLowMax] = useState("");
  const [lowBusy, setLowBusy] = useState(false);
  // Раскрыт ли блок точной настройки. Держим в состоянии, а не отдаём атрибуту
  // open как есть: React переприменяет его на каждый рендер и захлопывал бы
  // панель прямо под руками, стоит совпасть с пресетом.
  const [lowAdv, setLowAdv] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  // Свой статус рядом с кнопками: общий msg рисуется вверху страницы, а карточка
  // Telegram далеко внизу — результат «Отправить тест» туда просто не видно.
  const [tgMsg, setTgMsg] = useState(null);
  // Home Assistant. Токен, как и телеграмный, с сервера не приходит.
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");
  const [haWet, setHaWet] = useState("");
  const [haSensors, setHaSensors] = useState([]);
  const [haEntities, setHaEntities] = useState(null); // null = список ещё не загружен
  const [haBusy, setHaBusy] = useState(false);
  // Есть ли неотправленные правки списка датчиков.
  const [haDirty, setHaDirty] = useState(false);
  const [haMsg, setHaMsg] = useState(null);
  const [printers, setPrinters] = useState([]);
  const [locations, setLocations] = useState([]);
  const fileRef = useRef();
  // Раздел, на котором сейчас стоит прокрутка, — подсвечивается в оглавлении.
  const [activeSection, setActiveSection] = useState(SECTION_IDS[0]);
  // Какой датчик раскрыт для правки. Одновременно — только один.
  const [openSensor, setOpenSensor] = useState(null);
  // Пока не истечёт — расчёт подсветки молчит и не перебивает выбор кликом.
  const suppressSpy = useRef(0);

  useEffect(() => {
    api.get("/api/settings").then((v) => {
      setS(v);
      setLowConfig(v);
      setTgChat(v.telegram_chat_id || "");
      setLowPct(String(v.spool_low_pct ?? 10));
      setLowMin(String(v.spool_low_min_g ?? 50));
      setLowMax(String(v.spool_low_max_g ?? 200));
      // Настройки не из пресета — сразу показываем, откуда взялись числа.
      setLowAdv(
        !LOW_PRESETS.some(
          (p) => p.pct === v.spool_low_pct && p.min_g === v.spool_low_min_g && p.max_g === v.spool_low_max_g
        )
      );
      setHaUrl(v.ha_base_url || "");
      setHaWet(String(v.humidity_alert_max_pct ?? 45));
      setHaSensors(v.ha_sensors || []);
    }).catch(() => {});
    api.get("/health").then((h) => setServerVersion(h.version)).catch(() => {});
    api.get("/api/filament-catalog/info").then(setCatalogInfo).catch(() => {});
    // Для выпадающих списков привязки датчика.
    api.get("/api/printers").then(setPrinters).catch(() => {});
    api.get("/api/locations").then(setLocations).catch(() => {});
  }, []);

  function goToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    suppressSpy.current = Date.now() + 400;
    setActiveSection(id);
    el.scrollIntoView({ block: "start" });
  }

  // Подсветка раздела в оглавлении. Считаем по положению секций, а не через
  // IntersectionObserver: высота разделов меняется после подгрузки данных
  // (список датчиков вырастает в разы), и наблюдатель успевает запомнить
  // устаревшие пересечения.
  //
  // Порог раздела — прокрутка, на которой его верх дойдёт до линии внимания
  // под шапкой. У последних разделов такого положения не существует: страница
  // кончается раньше, чем они успевают подняться. Поэтому их пороги делят
  // остаток прокрутки поровну — иначе подсветка навсегда застревает на
  // середине списка, а нижние пункты не загораются никогда.
  useEffect(() => {
    const LINE = 140;
    const pick = () => {
      if (Date.now() < suppressSpy.current) return;   // только что прыгнули по клику
      const y = window.scrollY;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (max === 0) { setActiveSection(SECTION_IDS[0]); return; }

      const marks = SECTION_IDS.map((id) => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().top + y - LINE : Infinity;
      });
      const tail = marks.filter((m) => m > max).length;
      if (tail) {
        const first = marks.length - tail;
        const start = first > 0 ? Math.min(marks[first - 1], max) : 0;
        const step = (max - start) / tail;
        for (let i = 0; i < tail; i++) marks[first + i] = start + step * (i + 1);
      }

      let current = SECTION_IDS[0];
      marks.forEach((m, i) => { if (y >= m) current = SECTION_IDS[i]; });
      setActiveSection(current);   // тот же id — React перерисовку пропустит
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
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
    ["feed_changed", t("Подача изменилась (хаб сняли/поставили)")],
    ["spool_low", t("Катушка заканчивается")],
    ["humidity_high", t("Влажность выше порога")],
  ];

  async function saveTelegram(patch) {
    setMsg(null);
    setTgMsg(null);
    try {
      const next = await api.put("/api/settings", patch);
      setS(next);
      // Порог остатка красит катушки по всему приложению — обновляем его сразу,
      // не дожидаясь перезахода (см. utils/spools.js).
      setLowConfig(next);
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

  async function saveLow(values) {
    const src = values || { pct: Number(lowPct), min_g: Number(lowMin), max_g: Number(lowMax) };
    const patch = {
      spool_low_pct: src.pct,
      spool_low_min_g: src.min_g,
      spool_low_max_g: src.max_g,
    };
    if (!Number.isFinite(patch.spool_low_pct) || patch.spool_low_min_g <= 0 || patch.spool_low_max_g <= 0) {
      setMsg(t("Заполните долю и оба зажима"));
      return;
    }
    setLowBusy(true);
    setMsg(null);
    try {
      const next = await api.put("/api/settings", patch);
      setS(next);
      setLowConfig(next);
      setMsg(t("Настройка сохранена"));
    } catch (err) { setMsg(err.message); }
    setLowBusy(false);
  }

  // Текущее состояние полей (ещё не сохранённое) — по нему считаются и подпись
  // «скажем, когда останется…», и подсветка выбранного пресета.
  const lowCfgDraft = { pct: Number(lowPct), min_g: Number(lowMin), max_g: Number(lowMax) };
  const lowPresetKey =
    LOW_PRESETS.find(
      (p) => p.pct === lowCfgDraft.pct && p.min_g === lowCfgDraft.min_g && p.max_g === lowCfgDraft.max_g
    )?.key || "custom";

  async function applyLowPreset(preset) {
    setLowPct(String(preset.pct));
    setLowMin(String(preset.min_g));
    setLowMax(String(preset.max_g));
    await saveLow({ pct: preset.pct, min_g: preset.min_g, max_g: preset.max_g });
  }

  // Что правило даёт для ходовых размеров катушек — чтобы не считать в уме.
  const lowPreview = [250, 750, 1000, 3000].map((capacity) => ({
    capacity,
    threshold: Math.round(
      lowThresholdFor(capacity, {
        pct: Number(lowPct),
        min_g: Number(lowMin),
        max_g: Number(lowMax),
      })
    ),
  }));

  async function saveTelegramBot() {
    const patch = { telegram_chat_id: tgChat.trim() };
    // Пустое поле токена = «не менять»; стереть можно кнопкой ниже.
    if (tgToken.trim()) patch.telegram_bot_token = tgToken.trim();
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

  // --- Home Assistant --------------------------------------------------------

  async function saveHa(patch) {
    setMsg(null);
    setHaMsg(null);
    setHaBusy(true);
    try {
      const next = await api.put("/api/settings", patch);
      setS(next);
      setHaSensors(next.ha_sensors || []);
      if (patch.ha_sensors) setHaDirty(false);
      setHaMsg({ ok: true, text: t("Настройка сохранена") });
      if (patch.ha_token) setHaToken("");
      return true;
    } catch (err) {
      setHaMsg({ ok: false, text: err.message });
      return false;
    } finally {
      setHaBusy(false);
    }
  }

  function saveHaConnection() {
    const patch = { ha_base_url: haUrl.trim() };
    // Пустое поле токена = «не менять».
    if (haToken.trim()) patch.ha_token = haToken.trim();
    const wet = Number(haWet);
    if (wet > 0 && wet < 100) patch.humidity_alert_max_pct = wet;
    return saveHa(patch);
  }

  async function testHa() {
    setHaMsg(null);
    setHaBusy(true);
    try {
      const r = await api.post("/api/settings/homeassistant/test");
      setHaMsg({ ok: true, text: `${t("Home Assistant отвечает. Найдено датчиков:")} ${r.sensors_found}` });
    } catch (err) {
      setHaMsg({ ok: false, text: err.message });
    }
    setHaBusy(false);
  }

  async function loadHaEntities() {
    setHaMsg(null);
    setHaBusy(true);
    try {
      const r = await api.get("/api/settings/homeassistant/entities");
      setHaEntities(r.entities || []);
      setHaMsg({ ok: true, text: `${t("Загружено датчиков:")} ${r.entities.length}. ${t("Теперь поля подсказывают варианты.")}` });
    } catch (err) {
      setHaMsg({ ok: false, text: err.message });
    }
    setHaBusy(false);
  }

  // Правки списка датчиков живут в состоянии до нажатия «Сохранить датчики»:
  // сохранять на каждую букву в поле entity_id смысла нет, а недозаполненный
  // датчик (без единой сущности) сервер отбросит — и строка исчезнет прямо
  // из-под рук. Поэтому правки копятся, а флаг ниже показывает, что они есть.
  function patchSensor(i, patch) {
    setHaSensors((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setHaDirty(true);
  }
  function addSensor() {
    setHaSensors((prev) => {
      setOpenSensor(prev.length);   // новый датчик сразу раскрыт — заполнять нечего вслепую
      return [...prev, { name: "", temp_entity: "", humidity_entity: "", battery_entity: "", bind_type: null, bind_id: null }];
    });
    setHaDirty(true);
  }
  function removeSensor(i) {
    setHaSensors((prev) => prev.filter((_, idx) => idx !== i));
    setOpenSensor(null);
    setHaDirty(true);
  }

  // Короткая подпись привязки для свёрнутой строки. Формулировки те же, что в
  // списке «Где показывать», — иначе одно и то же место называлось бы по-разному.
  function bindLabel(sensor) {
    if (sensor.bind_type === "printer") {
      const p = printers.find((x) => x.id === sensor.bind_id);
      if (p) return `${t("Принтер")}: ${p.name}`;
    }
    if (sensor.bind_type === "location") {
      const l = locations.find((x) => x.id === sensor.bind_id);
      if (l) return `${t("Место хранения")}: ${l.name}`;
    }
    return t("Отдельным блоком на панели");
  }

  // Куда попадут показания при выбранной привязке — иначе эффект селекта виден
  // только на других страницах и выглядит так, будто ничего не произошло.
  function bindHint(sensor) {
    if (sensor.bind_type === "printer") {
      const p = printers.find((x) => x.id === sensor.bind_id);
      return p ? `${t("Показания появятся под слотами принтера")} «${p.name}».` : null;
    }
    if (sensor.bind_type === "location") {
      const l = locations.find((x) => x.id === sensor.bind_id);
      return l ? `${t("Показания появятся в разделе «Места хранения», в строке")} «${l.name}».` : null;
    }
    return t("Показания появятся на панели отдельной карточкой «Условия хранения».");
  }

  // Подсказки для полей entity_id: HA-сущности нужного класса.
  const entityOptions = (deviceClass) =>
    (haEntities || []).filter((e) => e.device_class === deviceClass);

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

  // Состояние раздела для оглавления. Считается только из того, что реально
  // известно: «Включён» значит «настроен и не выключен», а не «проверено».
  // Разделы без состояния (бэкап, разовый импорт) его и не показывают.
  function linkState(configured, enabled, activeText) {
    if (!configured) return { on: false, text: t("Не настроен") };
    if (!enabled) return { on: false, text: t("Выключен") };
    return { on: true, text: activeText || t("Включён") };
  }
  const SECTION_STATE = {
    prints: {
      on: autoMode !== "off",
      text: AUTO_MODES.find((m) => m.key === autoMode)?.label,
    },
    consumption: {
      on: s.allow_negative_consumption,
      text: s.allow_negative_consumption ? t("В минус разрешено") : t("В минус запрещено"),
    },
    telegram: linkState(s.telegram_token_set && !!s.telegram_chat_id, s.telegram_enabled),
    sensors: linkState(
      s.ha_token_set && !!s.ha_base_url,
      s.ha_enabled,
      `${t("Датчиков:")} ${(s.ha_sensors || []).length}`
    ),
    catalog: catalogInfo?.count ? { on: true, text: `${t("Записей:")} ${catalogInfo.count}` } : null,
    spoolman: null,
    backup: null,
    journal: { on: s.error_logging, text: s.error_logging ? t("Пишется") : t("Выключен") },
  };

  const SECTION_NODES = {
    prints: (
      <section key="prints" id="prints" className="card settings-section">
        <h3 className="card-title-lg">{t("Завершённые печати")}</h3>
        <div className="card-sub" style={{ marginBottom: 12 }}>
          {t("Что приложение делает с завершёнными печатями с принтера.")}
        </div>
        <div className="seg-toggle" role="tablist" aria-label={SECTION_TITLES.prints}>
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
      </section>
    ),
    consumption: (
      <section key="consumption" id="consumption" className="card settings-section">
        <h3 className="card-title-lg">{t("Списание")}</h3>
        <Toggle
          k="allow_negative_consumption"
          label={t("Разрешить списание катушки в минус при нехватке остатка")}
        />
        {!isAdmin && <div className="muted" style={{ marginTop: 6 }}>{t("Доступно только администратору.")}</div>}
      </section>
    ),
    low: (
      <section key="low" id="low" className="card settings-section">
        <h3 className="card-title-lg">{t("Остаток филамента")}</h3>
        <p className="muted">
          {t("Когда предупреждать, что катушка заканчивается: остаток краснеет в списках, катушка попадает в «Заканчиваются» на панели и уходит уведомление.")}
        </p>

        <div className="low-presets">
          {LOW_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`low-preset${lowPresetKey === preset.key ? " active" : ""}`}
              disabled={!isAdmin || lowBusy}
              onClick={() => applyLowPreset(preset)}
            >
              <b>{t(preset.label)}</b>
              <span className="muted">{t(preset.hint)}</span>
            </button>
          ))}
        </div>

        {/* Главное объяснение — не формула, а два числа: когда именно скажем.
            Порог считается от размера катушки, поэтому и примера два. */}
        <div className="low-explain">
          {t("Скажем, когда останется")}{" "}
          <b className="mono">{Math.round(lowThresholdFor(1000, lowCfgDraft))}{" "}{t("г")}</b>{" "}
          {t("на обычной катушке 1 кг")}
          {" — "}
          {t("и")}{" "}
          <b className="mono">{Math.round(lowThresholdFor(250, lowCfgDraft))}{" "}{t("г")}</b>{" "}
          {t("на маленькой 250 г.")}
        </div>

        {isAdmin && (
          <details
            className="low-advanced"
            open={lowAdv}
            onToggle={(e) => setLowAdv(e.currentTarget.open)}
          >
            <summary>{t("Настроить точнее")}</summary>
            <p className="muted" style={{ fontSize: 12 }}>
              {t("Порог считается как доля от размера катушки, но не выходит за границы в граммах. Это и позволяет одной настройке работать и на пробнике 250 г, и на бухте 3 кг.")}
            </p>
            <div className="row">
              <label>
                {t("Доля от катушки, %")}
                <input type="number" min="0" max="100" value={lowPct}
                  onChange={(e) => setLowPct(e.target.value)} />
              </label>
              <label>
                {t("Не меньше, г")}
                <input type="number" min="1" value={lowMin}
                  onChange={(e) => setLowMin(e.target.value)} />
              </label>
              <label>
                {t("Не больше, г")}
                <input type="number" min="1" value={lowMax}
                  onChange={(e) => setLowMax(e.target.value)} />
              </label>
            </div>
            <div className="low-preview">
              {lowPreview.map((p) => (
                <div key={p.capacity}>
                  <span className="muted">
                    {p.capacity >= 1000 ? `${p.capacity / 1000} ${t("кг")}` : `${p.capacity} ${t("г")}`}
                  </span>
                  <b className="mono">{p.threshold}{" "}{t("г")}</b>
                </div>
              ))}
            </div>
            <button className="secondary" onClick={saveLow} disabled={lowBusy} style={{ marginTop: 12 }}>
              {t("Сохранить")}
            </button>
          </details>
        )}
        {!isAdmin && <div className="muted" style={{ marginTop: 6 }}>{t("Доступно только администратору.")}</div>}
      </section>
    ),
    telegram: (
      <section key="telegram" id="telegram" className="card settings-section">
        <h3 className="card-title-lg">{t("Уведомления в Telegram")}</h3>
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
            <div className="settings-fields">
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
              <div className="settings-checks">
                {TG_EVENTS.map(([key, label]) => (
                  <label key={key}>
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
            </div>
          </>
        )}
      </section>
    ),
    sensors: (
      <section key="sensors" id="sensors" className="card settings-section">
        <h3 className="card-title-lg">{t("Датчики температуры и влажности")}</h3>
        <p className="muted">
          {t("Показания zigbee/wifi-датчиков из Home Assistant — на панели, рядом с принтером и в местах хранения. Нужен адрес HA и токен долгосрочного доступа (профиль в HA → «Токены долгосрочного доступа»).")}
        </p>
        {!isAdmin && <div className="muted">{t("Доступно только администратору.")}</div>}
        {isAdmin && (
          <>
            <Toggle
              k="ha_enabled"
              label={t("Показывать показания датчиков")}
              hint={t("Общий выключатель: пока выключен, Home Assistant не опрашивается.")}
            />
            <div className="settings-fields">
              <label>
                {t("Адрес Home Assistant")}
                <input
                  value={haUrl}
                  onChange={(e) => setHaUrl(e.target.value)}
                  placeholder="http://homeassistant.local:8123"
                />
              </label>
              <label>
                {t("Токен долгосрочного доступа")}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={haToken}
                  onChange={(e) => setHaToken(e.target.value)}
                  placeholder={s.ha_token_set ? t("Токен сохранён — введите новый, чтобы заменить") : "eyJhbGciOi..."}
                />
              </label>
              <label>
                {t("Общий порог «влажность высокая», %")}
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={haWet}
                  onChange={(e) => setHaWet(e.target.value)}
                />
              </label>
              <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                {t("Применяется к датчикам, у которых не задан свой порог. Выше порога показания подсвечиваются, а при включённом уведомлении «Влажность выше порога» приходит сообщение в Telegram.")}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="secondary" onClick={saveHaConnection} disabled={haBusy}>
                  {t("Сохранить")}
                </button>
                <button className="secondary" onClick={testHa} disabled={haBusy || !s.ha_token_set || !s.ha_base_url}>
                  {t("Проверить связь")}
                </button>
                <button className="secondary" onClick={loadHaEntities} disabled={haBusy || !s.ha_token_set || !s.ha_base_url}>
                  {t("Загрузить список датчиков")}
                </button>
              </div>
              {haMsg && (
                <div className={haMsg.ok ? "muted" : "error"} style={{ fontSize: 13 }}>
                  {haMsg.text}
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="card-sub" style={{ marginBottom: 8 }}>{t("Датчики")}</div>
              {haSensors.length === 0 && (
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                  {t("Датчики не добавлены. Нажмите «Добавить датчик» и укажите сущности температуры и влажности.")}
                </div>
              )}
              {haSensors.map((sensor, i) => (
                <div key={i} className="sensor-card">
                  {/* Свёрнутая строка отвечает на два вопроса: что за прибор и
                      где появятся его показания. Форма нужна только при правке. */}
                  <button
                    type="button"
                    className="sensor-head"
                    aria-expanded={openSensor === i}
                    onClick={() => setOpenSensor(openSensor === i ? null : i)}
                  >
                    <Icon name="chevron" size={14} />
                    <span>{sensor.name || t("Новый датчик")}</span>
                    <span className="muted sensor-where">{bindLabel(sensor)}</span>
                  </button>
                  {openSensor === i && (
                  <div className="sensor-body settings-fields">
                    <label>
                      {t("Название")}
                      <input
                        value={sensor.name || ""}
                        onChange={(e) => patchSensor(i, { name: e.target.value })}
                        placeholder={t("Сушилка ACE Pro")}
                      />
                    </label>
                    <label>
                      {t("Сущность температуры")}
                      <input
                        list="ha-temp-entities"
                        value={sensor.temp_entity || ""}
                        onChange={(e) => patchSensor(i, { temp_entity: e.target.value })}
                        placeholder="sensor.ace_pro_temp_hum_temperature"
                      />
                    </label>
                    <label>
                      {t("Сущность влажности")}
                      <input
                        list="ha-humidity-entities"
                        value={sensor.humidity_entity || ""}
                        onChange={(e) => patchSensor(i, { humidity_entity: e.target.value })}
                        placeholder="sensor.ace_pro_temp_hum_humidity"
                      />
                    </label>
                    <label>
                      {t("Сущность заряда батареи (необязательно)")}
                      <input
                        list="ha-battery-entities"
                        value={sensor.battery_entity || ""}
                        onChange={(e) => patchSensor(i, { battery_entity: e.target.value })}
                        placeholder="sensor.ace_pro_temp_hum_battery"
                      />
                    </label>
                    <label>
                      {t("Свой порог влажности, % (необязательно)")}
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={sensor.humidity_max ?? ""}
                        onChange={(e) => patchSensor(i, {
                          humidity_max: e.target.value === "" ? null : Number(e.target.value),
                        })}
                        placeholder={`${t("как общий")} — ${s.humidity_alert_max_pct}%`}
                      />
                    </label>
                    <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                      {t("Пусто — берётся общий порог. Разным местам нужны разные значения: в сушилке нагрев занижает влажность, а нейлону и PVA нужен порог жёстче, чем PLA.")}
                    </div>
                    <label>
                      {t("Где показывать")}
                      <select
                        value={sensor.bind_type && sensor.bind_id ? `${sensor.bind_type}:${sensor.bind_id}` : ""}
                        onChange={(e) => {
                          const [bind_type, bind_id] = e.target.value ? e.target.value.split(":") : [null, null];
                          patchSensor(i, { bind_type, bind_id });
                        }}
                      >
                        <option value="">{t("Отдельным блоком на панели")}</option>
                        {printers.map((p) => (
                          <option key={p.id} value={`printer:${p.id}`}>{t("Принтер")}: {p.name}</option>
                        ))}
                        {locations.map((l) => (
                          <option key={l.id} value={`location:${l.id}`}>{t("Место хранения")}: {l.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                      {bindHint(sensor)}
                    </div>
                    <div>
                      <button className="danger secondary" onClick={() => removeSensor(i)}>
                        {t("Удалить датчик")}
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="secondary" onClick={addSensor}>{t("Добавить датчик")}</button>
                {/* Пока правки не отправлены — кнопка обычная (акцентная), иначе
                    нечем отличить сохранённое состояние от несохранённого. */}
                <button
                  className={haDirty ? "" : "secondary"}
                  onClick={() => saveHa({ ha_sensors: haSensors })}
                  disabled={haBusy || !haDirty}
                >
                  {t("Сохранить датчики")}
                </button>
                {haDirty && (
                  <span className="badge almost_empty">{t("есть несохранённые изменения")}</span>
                )}
              </div>
              {/* Подсказки к полям entity_id — заполняются кнопкой «Загрузить список датчиков». */}
              <datalist id="ha-temp-entities">
                {entityOptions("temperature").map((e) => (
                  <option key={e.entity_id} value={e.entity_id}>{e.name}</option>
                ))}
              </datalist>
              <datalist id="ha-humidity-entities">
                {entityOptions("humidity").map((e) => (
                  <option key={e.entity_id} value={e.entity_id}>{e.name}</option>
                ))}
              </datalist>
              <datalist id="ha-battery-entities">
                {entityOptions("battery").map((e) => (
                  <option key={e.entity_id} value={e.entity_id}>{e.name}</option>
                ))}
              </datalist>
            </div>
          </>
        )}
      </section>
    ),
    catalog: (
      <section key="catalog" id="catalog" className="card settings-section">
        <h3 className="card-title-lg">{t("Каталог филамента")}</h3>
        <p className="muted">
          {t("Автозаполнение катушки по базе филаментов")}{" "}
          <a href="https://github.com/Donkie/SpoolmanDB" target="_blank" rel="noreferrer">SpoolmanDB</a>
          {catalogInfo?.count ? ` · ${catalogInfo.count} ${t("записей")}` : ""}.{" "}
          {t("Снапшот встроен и работает офлайн; кнопка ниже подтягивает свежую версию.")}
        </p>
        <button className="secondary" onClick={refreshCatalog} disabled={catalogBusy}>
          {catalogBusy ? t("Обновление…") : t("Обновить из SpoolmanDB")}
        </button>
      </section>
    ),
    spoolman: (
      <section key="spoolman" id="spoolman" className="card settings-section">
        <h3 className="card-title-lg">{t("Импорт из Spoolman")}</h3>
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
      </section>
    ),
    backup: (
      <section key="backup" id="backup" className="card settings-section">
        <h3 className="card-title-lg">{t("Бэкап")}</h3>
        <p className="muted">{t("Экспорт всех ваших данных в JSON и восстановление из файла (данные заменяются: текущие удаляются).")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={exportBackup}>{t("Скачать бэкап (JSON)")}</button>
          <button className="secondary" onClick={() => fileRef.current.click()}>{t("Восстановить из файла")}</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={importBackup} />
        </div>
      </section>
    ),
    journal: (
      <section key="journal" id="journal" className="card settings-section">
        <h3 className="card-title-lg">{t("Диагностический журнал")}</h3>
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
      </section>
    ),
  };

  return (
    <div>
      <h2>{t("Настройки")}</h2>
      {msg && <div className="muted" style={{ marginBottom: 8 }}>{msg}</div>}

      <div className="settings-layout">
        <nav className="settings-rail" aria-label={t("Разделы настроек")}>
          {GROUPS.map((g) => (
            <div className="rail-group" key={g.title}>
              <div className="eyebrow rail-group-title">{g.title}</div>
              {g.ids.map((id) => {
                const st = SECTION_STATE[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={`rail-item${activeSection === id ? " active" : ""}`}
                    aria-current={activeSection === id ? "true" : undefined}
                    onClick={() => goToSection(id)}
                  >
                    {st && <span className={`rail-dot${st.on ? " on" : ""}`} aria-hidden="true" />}
                    <span className="rail-text">
                      <span className="rail-name">{SECTION_TITLES[id]}</span>
                      {st && <span className="rail-state">{st.text}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="settings-sections">
          {GROUPS.map((g) => (
            <div className="settings-group" key={g.title}>
              <h3 className="settings-group-title">{g.title}</h3>
              {g.ids.map((id) => SECTION_NODES[id])}
            </div>
          ))}

          <div className="muted settings-version">
            Filament Tracker · {t("интерфейс")} <span className="mono">{window.__FT_CONFIG__?.version || "dev"}</span>
            {serverVersion && <> · {t("сервер")} <span className="mono">{serverVersion}</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}
