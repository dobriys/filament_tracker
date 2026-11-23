import { useEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { ChevronDown, ChevronRight } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Toggle } from "@/components/base/toggle/toggle";
import { Card, CardHeader, PageHeader } from "../components/ft/ui.jsx";
import { NONE, Pick, SectionLabel } from "../components/ft/form.jsx";
import { Notice, Stat } from "../components/ft/printer.jsx";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { useAuth } from "../api/auth.jsx";
import { dateLocale, t } from "../i18n.js";
import { lowThresholdFor, setLowConfig } from "../utils/spools.js";

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

// Часовой пояс для времени в уведомлениях. Список берём у браузера: держать
// свой список из четырёх сотен имён и следить за его актуальностью незачем.
// В старых движках метода нет — тогда остаются пояс устройства и сохранённый.
const TZ_BROWSER = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const TZ_ALL = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

// Который час в этом поясе прямо сейчас — проверка выбора без отправки теста.
function timeIn(zone) {
  try {
    return new Date().toLocaleTimeString(dateLocale(), {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

// Готовые ответы на вопрос «когда предупреждать, что катушка кончается».
// Рядовому пользователю не нужно знать про доли и границы — ему нужно выбрать,
// узнавать ли заранее. Точные числа остаются под «Настроить точнее».
const LOW_PRESETS = [
  { key: "early",  label: "Заранее",           hint: "успеть заказать замену", pct: 15, min_g: 80, max_g: 400 },
  { key: "normal", label: "Обычно",            hint: "рекомендуется",          pct: 10, min_g: 50, max_g: 200 },
  { key: "late",   label: "В самом конце",     hint: "меньше уведомлений",     pct: 5,  min_g: 40, max_g: 100 },
];

const LEVEL_COLOR = { error: "error", warning: "warning" };

/** Раздел настроек: карточка с заголовком, пояснением и содержимым. */
function Section({ id, title, description, children }) {
  return (
    <Card id={id} className="scroll-mt-20 lg:scroll-mt-8">
      <CardHeader title={title} description={description} />
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </Card>
  );
}

const AdminOnly = () => <p className="m-0 text-sm text-tertiary">{t("Доступно только администратору.")}</p>;
const Hint = ({ children }) => <p className="m-0 text-sm text-tertiary">{children}</p>;

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [s, setS] = useState({
    allow_negative_consumption: false,
    timezone: "",
    moonraker_auto_import: true,
    moonraker_auto_consume: false,
    error_logging: false,
    telegram_enabled: false,
    telegram_chat_id: "",
    telegram_token_set: false,
    telegram_events: {},
    telegram_photo_enabled: false,
    telegram_photo_events: {},
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
  // Общее уведомление {ok, text}: рисуется всплывающей плашкой, видной при любой
  // прокрутке (карточки далеко друг от друга, а результат действия должен быть
  // заметен сразу).
  const [msg, setMsg] = useState(null);
  const say = (text) => setMsg({ ok: true, text });
  const fail = (text) => setMsg({ ok: false, text });
  const [serverVersion, setServerVersion] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
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
  // Раскрыт ли блок точной настройки.
  const [lowAdv, setLowAdv] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  // Свой статус рядом с кнопками карточки Telegram: результат «Отправить тест»
  // должен быть виден там же, где нажали.
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
    api.get("/api/updates/latest").then(setUpdateInfo).catch(() => {});
    api.get("/api/filament-catalog/info").then(setCatalogInfo).catch(() => {});
    // Для выпадающих списков привязки датчика.
    api.get("/api/printers").then(setPrinters).catch(() => {});
    api.get("/api/locations").then(setLocations).catch(() => {});
  }, []);

  // Успех уходит сам через несколько секунд, ошибка остаётся, пока её не закроют.
  useEffect(() => {
    if (!msg?.ok) return undefined;
    const timer = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(timer);
  }, [msg]);

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
      say(`${t("Каталог филамента обновлён:")} ${r.count} ${t("записей")}`);
    } catch (err) { fail(err.message); }
    setCatalogBusy(false);
  }

  // Применяем ответ сервера (PUT возвращает полное состояние), а не оптимистично:
  // при ошибке состояние не меняется — переключатель сам «откатится».
  async function saveToggle(key, value) {
    try {
      setS(await api.put("/api/settings", { [key]: value }));
      say(t("Настройка сохранена"));
    } catch (err) { fail(err.message); }
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
      say(t("Настройка сохранена"));
    } catch (err) { fail(err.message); }
  }

  /** Выключатель настройки с подписью и пояснением. */
  const setting = (k, label, hint) => (
    <Toggle
      size="sm"
      className="max-w-full"
      isSelected={!!s[k]}
      onChange={(v) => saveToggle(k, v)}
      isDisabled={!isAdmin}
      label={label}
      hint={hint}
    />
  );

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

  // К каким событиям можно приложить кадр с камеры — то же, что
  // notifications.PHOTO_EVENTS на бэкенде. Подписи берём из TG_EVENTS.
  const TG_PHOTO_KEYS = ["print_started", "print_finished", "print_error", "print_cancelled", "print_paused"];
  const TG_PHOTO_EVENTS = TG_EVENTS.filter(([key]) => TG_PHOTO_KEYS.includes(key));

  async function saveTelegram(patch) {
    setMsg(null);
    setTgMsg(null);
    try {
      const next = await api.put("/api/settings", patch);
      setS(next);
      // Порог остатка красит катушки по всему приложению — обновляем его сразу,
      // не дожидаясь перезахода (см. utils/spools.js).
      setLowConfig(next);
      say(t("Настройка сохранена"));
      setTgMsg({ ok: true, text: t("Настройка сохранена") });
      return true;
    } catch (err) {
      fail(err.message);
      setTgMsg({ ok: false, text: err.message });
      return false;
    }
  }

  async function saveLow(values) {
    const src = values || { pct: Number(lowPct), min_g: Number(lowMin), max_g: Number(lowMax) };
    const patch = {
      spool_low_pct: src.pct,
      spool_low_min_g: src.min_g,
      spool_low_max_g: src.max_g,
    };
    if (!Number.isFinite(patch.spool_low_pct) || patch.spool_low_min_g <= 0 || patch.spool_low_max_g <= 0) {
      fail(t("Заполните долю и оба зажима"));
      return;
    }
    setLowBusy(true);
    setMsg(null);
    try {
      const next = await api.put("/api/settings", patch);
      setS(next);
      setLowConfig(next);
      say(t("Настройка сохранена"));
    } catch (err) { fail(err.message); }
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

  // Список «Где показывать»: панель, принтеры и места хранения.
  const bindItems = [
    { id: NONE, label: t("Отдельным блоком на панели") },
    ...printers.map((p) => ({ id: `printer:${p.id}`, label: `${t("Принтер")}: ${p.name}` })),
    ...locations.map((l) => ({ id: `location:${l.id}`, label: `${t("Место хранения")}: ${l.name}` })),
  ];

  // Пояса: «как на сервере», пояс этого устройства, все остальные и — если
  // сохранённого нет в списке браузера — он сам, иначе поле показало бы пустоту.
  const tzItems = useMemo(() => {
    const items = [
      { id: NONE, label: t("Как на сервере") },
      { id: TZ_BROWSER, label: TZ_BROWSER, supportingText: t("Это устройство") },
      ...TZ_ALL.filter((z) => z !== TZ_BROWSER).map((z) => ({ id: z, label: z })),
    ];
    if (s.timezone && s.timezone !== TZ_BROWSER && !TZ_ALL.includes(s.timezone)) {
      items.push({ id: s.timezone, label: s.timezone });
    }
    return items;
  }, [s.timezone]);

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
    } catch (err) { fail(err.message); }
  }
  async function clearLog() {
    setMsg(null);
    try {
      await api.post("/api/diagnostics/clear");
      setLog({ entries: [], total: 0 });
      say(t("Журнал очищен"));
    } catch (err) { fail(err.message); }
  }
  function downloadLog() {
    api.download("/api/diagnostics/log.txt", { filename: "filament-tracker-diagnostics.txt" })
      .catch((e) => fail(e.message));
  }

  async function importSpoolman() {
    const url = spoolmanUrl.trim();
    if (!url) return;
    setMsg(null);
    setSpoolmanBusy(true);
    try {
      const r = await api.post("/api/spools/import-spoolman", { url });
      say(`${t("Импорт из Spoolman: добавлено")} ${r.imported}, ${t("пропущено")} ${r.skipped} ${t("из")} ${r.total}`);
    } catch (err) { fail(err.message); }
    setSpoolmanBusy(false);
  }

  function exportBackup() {
    api.download("/api/backup/export", { filename: "filament-backup.json" }).catch((e) => fail(e.message));
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
      say(`${t("Восстановлено: профили")} ${res.filament_profiles}, ${t("катушки")} ${res.spools}, ${t("места")} ${res.locations}, ${t("принтеры")} ${res.printers}, ${t("печати")} ${res.print_jobs ?? 0}`);
    } catch (err) { fail(err.message); }
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

  const mode = AUTO_MODES.find((m) => m.key === autoMode);
  const msgOf = (m) => m && <Notice tone={m.ok ? "success" : "error"}>{m.text}</Notice>;

  const SECTION_NODES = {
    prints: (
      <Section key="prints" id="prints" title={t("Завершённые печати")} description={t("Что приложение делает с завершёнными печатями с принтера.")}>
        <div>
          <ButtonGroup
            size="md"
            aria-label={SECTION_TITLES.prints}
            selectionMode="single"
            disallowEmptySelection
            isDisabled={!isAdmin}
            selectedKeys={[autoMode]}
            onSelectionChange={(keys) => {
              const k = [...keys][0];
              if (k && k !== autoMode) setAutoMode(String(k));
            }}
          >
            {AUTO_MODES.map((m) => <ButtonGroupItem key={m.key} id={m.key}>{m.label}</ButtonGroupItem>)}
          </ButtonGroup>
        </div>
        <Hint><b className="font-semibold text-secondary">{mode?.label}.</b> {mode?.hint}</Hint>
        {!isAdmin && <AdminOnly />}
      </Section>
    ),

    consumption: (
      <Section key="consumption" id="consumption" title={t("Списание")}>
        {setting("allow_negative_consumption", t("Разрешить списание катушки в минус при нехватке остатка"))}
        {!isAdmin && <AdminOnly />}
      </Section>
    ),

    low: (
      <Section
        key="low" id="low" title={t("Остаток филамента")}
        description={t("Когда предупреждать, что катушка заканчивается: остаток краснеет в списках, катушка попадает в «Заканчиваются» на панели и уходит уведомление.")}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {LOW_PRESETS.map((preset) => (
            <AriaButton
              key={preset.key}
              onPress={() => applyLowPreset(preset)}
              isDisabled={!isAdmin || lowBusy}
              className={cx(
                "flex cursor-pointer flex-col items-start gap-0.5 rounded-xl p-4 text-left outline-focus-ring ring-inset transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
                lowPresetKey === preset.key ? "bg-brand-primary ring-2 ring-brand" : "bg-primary ring-1 ring-primary hover:bg-primary_hover",
              )}
            >
              <span className="text-sm font-semibold text-primary">{t(preset.label)}</span>
              <span className="text-sm text-tertiary">{t(preset.hint)}</span>
            </AriaButton>
          ))}
        </div>

        {/* Главное объяснение — не формула, а два числа: когда именно скажем.
            Порог считается от размера катушки, поэтому и примера два. */}
        <p className="m-0 text-sm text-secondary">
          {t("Скажем, когда останется")}{" "}
          <b className="font-semibold text-primary tabular-nums">{Math.round(lowThresholdFor(1000, lowCfgDraft))} {t("г")}</b>{" "}
          {t("на обычной катушке 1 кг")}
          {" — "}
          {t("и")}{" "}
          <b className="font-semibold text-primary tabular-nums">{Math.round(lowThresholdFor(250, lowCfgDraft))} {t("г")}</b>{" "}
          {t("на маленькой 250 г.")}
        </p>

        {isAdmin && (
          <div>
            <Button
              size="sm"
              color="link-color"
              iconTrailing={<ChevronDown className={cx("size-4 transition duration-100 ease-linear", lowAdv && "rotate-180")} aria-hidden="true" />}
              onClick={() => setLowAdv((v) => !v)}
            >
              {t("Настроить точнее")}
            </Button>
            {lowAdv && (
              <div className="mt-3 flex flex-col gap-4 rounded-xl p-4 ring-1 ring-secondary ring-inset">
                <Hint>
                  {t("Порог считается как доля от размера катушки, но не выходит за границы в граммах. Это и позволяет одной настройке работать и на пробнике 250 г, и на бухте 3 кг.")}
                </Hint>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input size="sm" type="number" min="0" max="100" label={t("Доля от катушки, %")} value={lowPct} onChange={setLowPct} />
                  <Input size="sm" type="number" min="1" label={t("Не меньше, г")} value={lowMin} onChange={setLowMin} />
                  <Input size="sm" type="number" min="1" label={t("Не больше, г")} value={lowMax} onChange={setLowMax} />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {lowPreview.map((p) => (
                    <Stat key={p.capacity} label={p.capacity >= 1000 ? `${p.capacity / 1000} ${t("кг")}` : `${p.capacity} ${t("г")}`}>
                      {p.threshold} {t("г")}
                    </Stat>
                  ))}
                </div>
                <div>
                  <Button size="md" color="secondary" onClick={() => saveLow()} isDisabled={lowBusy}>{t("Сохранить")}</Button>
                </div>
              </div>
            )}
          </div>
        )}
        {!isAdmin && <AdminOnly />}
      </Section>
    ),

    telegram: (
      <Section
        key="telegram" id="telegram" title={t("Уведомления в Telegram")}
        description={t("Сообщения об изменениях состояния принтера: печать завершена, ошибка, сушка и т.д. Создайте бота через @BotFather, получите токен, напишите боту и укажите chat id (узнать можно у @userinfobot).")}
      >
        {!isAdmin && <AdminOnly />}
        {isAdmin && (
          <>
            {setting(
              "telegram_enabled",
              t("Отправлять уведомления"),
              t("Общий выключатель: пока выключен, ничего не отправляется и принтеры не опрашиваются ради уведомлений."),
            )}
            <div className="flex flex-col gap-4 border-t border-secondary pt-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  size="sm" type="password" autoComplete="new-password" label={t("Токен бота")}
                  value={tgToken} onChange={setTgToken}
                  placeholder={s.telegram_token_set ? t("Токен сохранён — введите новый, чтобы заменить") : "123456:ABC-DEF..."}
                />
                <Input size="sm" label={t("Chat id")} value={tgChat} onChange={setTgChat} placeholder="123456789" />
              </div>
              <Hint>{t("Напишите боту «/start» и нажмите «Определить chat id» — вводить вручную не нужно.")}</Hint>
              <div className="flex flex-wrap gap-2">
                <Button size="md" color="secondary" onClick={saveTelegramBot} isDisabled={tgBusy}>{t("Сохранить")}</Button>
                <Button size="md" color="secondary" onClick={detectChat} isDisabled={tgBusy || !s.telegram_token_set}>
                  {t("Определить chat id")}
                </Button>
                <Button size="md" color="secondary" onClick={testTelegram} isDisabled={tgBusy || !s.telegram_token_set || !s.telegram_chat_id}>
                  {t("Отправить тест")}
                </Button>
              </div>
              {msgOf(tgMsg)}
            </div>

            <div className="border-t border-secondary pt-5">
              <SectionLabel>{t("Часовой пояс")}</SectionLabel>
              <div className="flex max-w-md flex-col gap-2">
                <Pick
                  label={t("Время в сообщениях")}
                  value={s.timezone || NONE}
                  onChange={(k) => saveTelegram({ timezone: k === NONE ? "" : k })}
                  items={tzItems}
                />
                <Hint>
                  {s.timezone
                    ? `${t("Сейчас в этом поясе:")} ${timeIn(s.timezone) || "—"}`
                    : t("Сервер обычно живёт по UTC — тогда время в сообщениях будет отличаться от вашего.")}
                </Hint>
              </div>
            </div>

            <div className="border-t border-secondary pt-5">
              <SectionLabel>{t("Что отправлять")}</SectionLabel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {TG_EVENTS.map(([key, label]) => (
                  <Checkbox
                    key={key}
                    size="sm"
                    label={label}
                    isSelected={!!s.telegram_events?.[key]}
                    onChange={(v) => saveTelegram({ telegram_events: { [key]: v } })}
                    isDisabled={!s.telegram_enabled}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-secondary pt-5">
              <SectionLabel className="mb-0">{t("Снимок с камеры")}</SectionLabel>
              {setting(
                "telegram_photo_enabled",
                t("Прикладывать кадр с камеры принтера"),
                t("Кадр уходит вместе с сообщением: сначала картинка, под ней текст. Камера не ответила — придёт обычное сообщение. Адрес камеры берётся у Moonraker, а задать свой можно в карточке принтера («Принтеры» → Moonraker)."),
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {TG_PHOTO_EVENTS.map(([key, label]) => (
                  <Checkbox
                    key={key}
                    size="sm"
                    label={label}
                    isSelected={!!s.telegram_photo_events?.[key]}
                    onChange={(v) => saveTelegram({ telegram_photo_events: { [key]: v } })}
                    isDisabled={!s.telegram_enabled || !s.telegram_photo_enabled}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </Section>
    ),

    sensors: (
      <Section
        key="sensors" id="sensors" title={t("Датчики температуры и влажности")}
        description={t("Показания zigbee/wifi-датчиков из Home Assistant — на панели, рядом с принтером и в местах хранения. Нужен адрес HA и токен долгосрочного доступа (профиль в HA → «Токены долгосрочного доступа»).")}
      >
        {!isAdmin && <AdminOnly />}
        {isAdmin && (
          <>
            {setting(
              "ha_enabled",
              t("Показывать показания датчиков"),
              t("Общий выключатель: пока выключен, Home Assistant не опрашивается."),
            )}
            <div className="flex flex-col gap-4 border-t border-secondary pt-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  size="sm" label={t("Адрес Home Assistant")} value={haUrl} onChange={setHaUrl}
                  placeholder="http://homeassistant.local:8123" className="sm:col-span-2"
                />
                <Input
                  size="sm" type="password" autoComplete="new-password" label={t("Токен долгосрочного доступа")}
                  value={haToken} onChange={setHaToken}
                  placeholder={s.ha_token_set ? t("Токен сохранён — введите новый, чтобы заменить") : "eyJhbGciOi..."}
                />
                <Input
                  size="sm" type="number" min="1" max="99" label={t("Общий порог «влажность высокая», %")}
                  value={haWet} onChange={setHaWet}
                />
              </div>
              <Hint>
                {t("Применяется к датчикам, у которых не задан свой порог. Выше порога показания подсвечиваются, а при включённом уведомлении «Влажность выше порога» приходит сообщение в Telegram.")}
              </Hint>
              <div className="flex flex-wrap gap-2">
                <Button size="md" color="secondary" onClick={saveHaConnection} isDisabled={haBusy}>{t("Сохранить")}</Button>
                <Button size="md" color="secondary" onClick={testHa} isDisabled={haBusy || !s.ha_token_set || !s.ha_base_url}>
                  {t("Проверить связь")}
                </Button>
                <Button size="md" color="secondary" onClick={loadHaEntities} isDisabled={haBusy || !s.ha_token_set || !s.ha_base_url}>
                  {t("Загрузить список датчиков")}
                </Button>
              </div>
              {msgOf(haMsg)}
            </div>

            <div className="border-t border-secondary pt-5">
              <SectionLabel>{t("Датчики")}</SectionLabel>
              <div className="flex flex-col gap-3">
                {haSensors.length === 0 && (
                  <Hint>{t("Датчики не добавлены. Нажмите «Добавить датчик» и укажите сущности температуры и влажности.")}</Hint>
                )}
                {haSensors.map((sensor, i) => {
                  const isOpen = openSensor === i;
                  return (
                    <div key={i} className="rounded-xl ring-1 ring-secondary ring-inset">
                      {/* Свёрнутая строка отвечает на два вопроса: что за прибор и
                          где появятся его показания. Форма нужна только при правке. */}
                      <AriaButton
                        onPress={() => setOpenSensor(isOpen ? null : i)}
                        aria-expanded={isOpen}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-transparent px-4 py-3 text-left outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 focus-visible:-outline-offset-2"
                      >
                        <ChevronRight className={cx("size-4 shrink-0 text-fg-quaternary transition duration-100 ease-linear", isOpen && "rotate-90")} aria-hidden="true" />
                        <span className="text-sm font-semibold text-primary">{sensor.name || t("Новый датчик")}</span>
                        <span className="ml-auto min-w-0 truncate text-sm text-tertiary">{bindLabel(sensor)}</span>
                      </AriaButton>
                      {isOpen && (
                        <div className="flex flex-col gap-4 border-t border-secondary p-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Input
                              size="sm" label={t("Название")} value={sensor.name || ""}
                              onChange={(v) => patchSensor(i, { name: v })} placeholder={t("Сушилка ACE Pro")}
                              className="sm:col-span-2"
                            />
                            <Input
                              size="sm" list="ha-temp-entities" label={t("Сущность температуры")} value={sensor.temp_entity || ""}
                              onChange={(v) => patchSensor(i, { temp_entity: v })} placeholder="sensor.ace_pro_temp_hum_temperature"
                            />
                            <Input
                              size="sm" list="ha-humidity-entities" label={t("Сущность влажности")} value={sensor.humidity_entity || ""}
                              onChange={(v) => patchSensor(i, { humidity_entity: v })} placeholder="sensor.ace_pro_temp_hum_humidity"
                            />
                            <Input
                              size="sm" list="ha-battery-entities" label={t("Сущность заряда батареи (необязательно)")} value={sensor.battery_entity || ""}
                              onChange={(v) => patchSensor(i, { battery_entity: v })} placeholder="sensor.ace_pro_temp_hum_battery"
                            />
                            <Input
                              size="sm" type="number" min="1" max="99" label={t("Свой порог влажности, % (необязательно)")}
                              value={String(sensor.humidity_max ?? "")}
                              onChange={(v) => patchSensor(i, { humidity_max: v === "" ? null : Number(v) })}
                              placeholder={`${t("как общий")} — ${s.humidity_alert_max_pct}%`}
                            />
                          </div>
                          <Hint>
                            {t("Пусто — берётся общий порог. Разным местам нужны разные значения: в сушилке нагрев занижает влажность, а нейлону и PVA нужен порог жёстче, чем PLA.")}
                          </Hint>
                          <Pick
                            label={t("Где показывать")}
                            value={sensor.bind_type && sensor.bind_id ? `${sensor.bind_type}:${sensor.bind_id}` : NONE}
                            onChange={(k) => {
                              if (k === NONE) { patchSensor(i, { bind_type: null, bind_id: null }); return; }
                              const [bind_type, ...rest] = k.split(":");
                              patchSensor(i, { bind_type, bind_id: rest.join(":") });
                            }}
                            items={bindItems}
                          />
                          <Hint>{bindHint(sensor)}</Hint>
                          <div>
                            <Button size="sm" color="secondary-destructive" onClick={() => removeSensor(i)}>{t("Удалить датчик")}</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="md" color="secondary" onClick={addSensor}>{t("Добавить датчик")}</Button>
                  {/* Пока правки не отправлены — кнопка акцентная, иначе
                      нечем отличить сохранённое состояние от несохранённого. */}
                  <Button size="md" color={haDirty ? "primary" : "secondary"} onClick={() => saveHa({ ha_sensors: haSensors })} isDisabled={haBusy || !haDirty}>
                    {t("Сохранить датчики")}
                  </Button>
                  {haDirty && <Badge size="sm" color="warning" type="pill-color">{t("есть несохранённые изменения")}</Badge>}
                </div>
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
      </Section>
    ),

    catalog: (
      <Section key="catalog" id="catalog" title={t("Каталог филамента")}>
        <Hint>
          {t("Автозаполнение катушки по базе филаментов")}{" "}
          <AriaLink href="https://github.com/Donkie/SpoolmanDB" target="_blank" rel="noreferrer" className="cursor-pointer rounded-sm text-brand-secondary outline-focus-ring hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">SpoolmanDB</AriaLink>
          {catalogInfo?.count ? ` · ${catalogInfo.count} ${t("записей")}` : ""}.{" "}
          {t("Снапшот встроен и работает офлайн; кнопка ниже подтягивает свежую версию.")}
        </Hint>
        <div>
          <Button size="md" color="secondary" onClick={refreshCatalog} isLoading={catalogBusy}>
            {catalogBusy ? t("Обновление…") : t("Обновить из SpoolmanDB")}
          </Button>
        </div>
      </Section>
    ),

    spoolman: (
      <Section
        key="spoolman" id="spoolman" title={t("Импорт из Spoolman")}
        description={t("Перенос катушек из вашего Spoolman по сети. Повторный импорт пропускает уже добавленные катушки.")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm" aria-label={t("Импорт из Spoolman")} className="min-w-64 flex-1"
            value={spoolmanUrl} onChange={setSpoolmanUrl} placeholder="http://spoolman.local:7912"
          />
          <Button size="md" color="secondary" onClick={importSpoolman} isLoading={spoolmanBusy} isDisabled={!spoolmanUrl.trim()}>
            {spoolmanBusy ? t("Импорт…") : t("Импортировать")}
          </Button>
        </div>
      </Section>
    ),

    backup: (
      <Section
        key="backup" id="backup" title={t("Бэкап")}
        description={t("Экспорт всех ваших данных в JSON и восстановление из файла (данные заменяются: текущие удаляются).")}
      >
        <div className="flex flex-wrap gap-2">
          <Button size="md" color="secondary" onClick={exportBackup}>{t("Скачать бэкап (JSON)")}</Button>
          <Button size="md" color="secondary" onClick={() => fileRef.current?.click()}>{t("Восстановить из файла")}</Button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importBackup} />
        </div>
      </Section>
    ),

    journal: (
      <Section
        key="journal" id="journal" title={t("Диагностический журнал")}
        description={t("Для отладки: включите запись, повторите проблемные действия, затем скачайте журнал и приложите его к issue на GitHub. Пишутся действия (запросы к серверу с результатом), автоматизация принтера (импорт, автосписание, сушка) и ошибки — бэкенда и браузера. Хранится в базе (последние 5000 записей).")}
      >
        {setting(
          "error_logging",
          t("Записывать действия и ошибки"),
          t("Личных данных в записях обычно нет, но перед публикацией просмотрите журнал: секреты (пароли, ключи) вырезаются автоматически."),
        )}
        {!isAdmin && <AdminOnly />}
        {isAdmin && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-t border-secondary pt-5">
              <Pick
                aria-label={t("Все уровни")}
                className="w-36"
                value={logFilter.level || NONE}
                onChange={(k) => { const f = { ...logFilter, level: k === NONE ? "" : k }; setLogFilter(f); loadLog(f); }}
                items={[{ id: NONE, label: t("Все уровни") }, ...["info", "warning", "error"].map((l) => ({ id: l, label: l }))]}
              />
              <Pick
                aria-label={t("Все источники")}
                className="w-40"
                value={logFilter.source || NONE}
                onChange={(k) => { const f = { ...logFilter, source: k === NONE ? "" : k }; setLogFilter(f); loadLog(f); }}
                items={[{ id: NONE, label: t("Все источники") }, ...["http", "poller", "backend", "frontend"].map((l) => ({ id: l, label: l }))]}
              />
              <Input
                size="sm" aria-label={t("Поиск по тексту/пути")} className="min-w-44 flex-1"
                placeholder={t("Поиск по тексту/пути")} value={logFilter.q}
                onChange={(v) => setLogFilter({ ...logFilter, q: v })}
                onKeyDown={(e) => { if (e.key === "Enter") loadLog(); }}
              />
              <Button size="md" color="secondary" onClick={() => loadLog()}>{t("Показать")}</Button>
              <Button size="md" color="secondary" onClick={downloadLog}>{t("Скачать (.txt)")}</Button>
              <Button size="md" color="secondary" onClick={clearLog}>{t("Очистить")}</Button>
            </div>
            {log !== null && (
              log.entries.length === 0 ? (
                <Hint>{t("Журнал пуст.")}</Hint>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="m-0 text-xs text-tertiary">{t("Показано")} {log.entries.length} {t("из")} {log.total}</p>
                  <div className="max-h-96 overflow-auto rounded-lg bg-secondary_alt text-xs ring-1 ring-secondary ring-inset">
                    {log.entries.map((e) => (
                      <div key={e.id} className="border-b border-secondary px-3 py-2 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge size="sm" color={LEVEL_COLOR[e.level] || "gray"} type="pill-color">{e.level}</Badge>
                          <span className="font-mono text-tertiary">{e.time}</span>
                          <span className="font-mono text-primary">{e.source}</span>
                          {e.status != null && <span className="font-mono text-tertiary">{e.status}</span>}
                          {e.duration_ms != null && <span className="font-mono text-tertiary">{e.duration_ms}ms</span>}
                        </div>
                        <div className="mt-1 font-mono break-words text-primary">
                          {e.action || `${e.method || ""} ${e.path || ""}`}
                        </div>
                        {e.message && <div className="mt-1 break-words text-secondary">{e.message}</div>}
                        {e.context && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-tertiary">{t("подробнее")}</summary>
                            <pre className="m-0 mt-1 text-[11px] whitespace-pre-wrap text-secondary">
                              {JSON.stringify(e.context, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </>
        )}
      </Section>
    ),
  };

  // Кнопка раздела в оглавлении: точка состояния, название и подпись.
  const railItem = (id) => {
    const st = SECTION_STATE[id];
    const active = activeSection === id;
    return (
      <AriaButton
        key={id}
        onPress={() => goToSection(id)}
        aria-current={active ? "true" : undefined}
        className={cx(
          "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:-outline-offset-2",
          active ? "bg-secondary_hover" : "bg-transparent hover:bg-primary_hover",
        )}
      >
        <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", st ? (st.on ? "bg-success-solid" : "bg-quaternary") : "bg-transparent")} aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span className={cx("text-sm font-medium", active ? "text-primary" : "text-secondary")}>{SECTION_TITLES[id]}</span>
          {st && <span className="text-xs text-tertiary">{st.text}</span>}
        </span>
      </AriaButton>
    );
  };

  return (
    <div>
      <PageHeader title={t("Настройки")} />

      {/* Результат действий — плашкой поверх страницы: карточки далеко друг от друга */}
      {msg && (
        <div className="fixed inset-x-4 bottom-24 z-40 lg:inset-x-auto lg:right-8 lg:bottom-8 lg:w-96">
          <Notice tone={msg.ok ? "success" : "error"} className="shadow-lg" onClose={() => setMsg(null)}>{msg.text}</Notice>
        </div>
      )}

      {/* На узком экране оглавления слева нет — вместо него полоса разделов */}
      <nav aria-label={t("Разделы настроек")} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2">
          {SECTION_IDS.map((id) => (
            <AriaButton
              key={id}
              onPress={() => goToSection(id)}
              className={cx(
                "cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-focus-ring ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2",
                activeSection === id ? "bg-brand-primary text-brand-secondary ring-utility-brand-200" : "bg-primary text-secondary ring-primary",
              )}
            >
              {SECTION_TITLES[id]}
            </AriaButton>
          ))}
        </div>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label={t("Разделы настроек")} className="hidden self-start lg:sticky lg:top-8 lg:flex lg:flex-col lg:gap-6">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="m-0 mb-1.5 px-3 text-xs font-medium text-quaternary">{g.title}</p>
              <div className="flex flex-col gap-0.5">{g.ids.map(railItem)}</div>
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-10">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-4">
              <h2 className="m-0 text-lg font-semibold text-primary">{g.title}</h2>
              <div className="flex flex-col gap-6">{g.ids.map((id) => SECTION_NODES[id])}</div>
            </div>
          ))}

          <p className="m-0 text-sm text-tertiary">
            Filament Tracker · {t("интерфейс")} <span className="font-mono">{window.__FT_CONFIG__?.version || "dev"}</span>
            {serverVersion && <> · {t("сервер")} <span className="font-mono">{serverVersion}</span></>}
            {updateInfo?.update_available && (
              <> · <AriaLink href={updateInfo.release_url} target="_blank" rel="noreferrer" className="cursor-pointer rounded-sm font-medium text-brand-secondary outline-focus-ring hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
                {t("доступна новая версия")} <span className="font-mono">{updateInfo.latest_version}</span>
              </AriaLink></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
