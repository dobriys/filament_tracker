import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, tReason } from "../i18n.js";
import { GateChips, GateEditor } from "../components/HubGates.jsx";
import { PrinterArt, brandAccent } from "../components/PrinterArt.jsx";
import EnvSensor, { useEnvSensors } from "../components/EnvSensor.jsx";
import FeedChangeBanner from "../components/FeedChangeBanner.jsx";
import { slotLabel } from "../utils/slots.js";
import LightToggle from "../components/LightToggle.jsx";
import { Button as AriaButton } from "react-aria-components";
import { CheckCircle, Disc01, Droplets02, PauseCircle, PlayCircle, Plus, StopCircle } from "@untitledui/icons";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Toggle } from "@/components/base/toggle/toggle";
import { cx } from "@/utils/cx";
import { Card, CardHeader, MetricCard, PageHeader, SpoolSwatch } from "../components/ft/ui.jsx";
import { Notice, Stat, StateBadge, ZoneTitle } from "../components/ft/printer.jsx";

const MAT_COLORS = ["#2e6be6", "#3d4657", "#17a34a", "#f6a723", "#8a5fbf", "#e0526e", "#17a2a6", "#9aa1ab"];

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60) || 1} ${t("мин назад")}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${t("ч назад")}`;
  return `${Math.floor(s / 86400)} ${t("дн назад")}`;
}

// Стопочные столбики: каждый месяц разложен по материалу. Цвет закреплён за
// материалом (colorFor), поэтому столбики и пончик рядом говорят одним цветом.
function BarChart({ data, materials, colorFor }) {
  const W = 420, H = 165, padL = 34, padB = 24, padT = 8;
  const max = Math.max(1, ...data.map((d) => d.grams));
  // «красивый» потолок чуть выше максимума — столбики читаются при любых данных
  const unit = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = [1, 1.5, 2, 3, 5, 10].map((k) => k * unit).find((v) => v >= max) || max;
  const cw = W - padL, ch = H - padB - padT;
  const bw = (cw / data.length) * 0.55;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {ticks.map((tk, i) => {
          const y = padT + ch * (1 - tk);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W} y2={y} stroke="var(--color-border-secondary)" strokeWidth="1" strokeDasharray="3 4" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-text-quaternary)">{Math.round(niceMax * tk)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = padL + (cw / data.length) * i + (cw / data.length - bw) / 2;
          const total = d.grams || 0;
          const barH = ch * (total / niceMax);
          const barTop = padT + ch - barH;
          // Сегменты снизу вверх; крупный материал (первый в materials) — в основании.
          const segs = materials.map((m) => [m, d.by_material?.[m] || 0]).filter(([, g]) => g > 0);
          let yb = padT + ch;
          const clip = `barclip${i}`;
          return (
            <g key={i}>
              {barH > 0 && (
                <clipPath id={clip}>
                  <rect x={x} y={barTop} width={bw} height={barH} rx="4" />
                </clipPath>
              )}
              <g clipPath={barH > 0 ? `url(#${clip})` : undefined}>
                {segs.map(([m, g]) => {
                  const h = ch * (g / niceMax);
                  yb -= h;
                  return (
                    <rect key={m} x={x} y={yb} width={bw} height={h} fill={colorFor(m)}>
                      <title>{`${t(d.label)} · ${m}: ${g} ${t("г")}`}</title>
                    </rect>
                  );
                })}
              </g>
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-text-quaternary)">{t(d.label)}</text>
            </g>
          );
        })}
      </svg>
      {materials.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-tertiary">
          {materials.map((m) => (
            <span key={m} className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full" style={{ background: colorFor(m) }} />{m}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function Donut({ data, colorFor }) {
  const total = data.reduce((a, d) => a + d.grams, 0) || 1;
  const r = 55, c = 2 * Math.PI * r, cx = 80, cy = 80;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 160 160" width="128" height="128">
        <g transform="rotate(-90 80 80)">
          {data.map((d, i) => {
            const frac = d.grams / total;
            const dash = frac * c;
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={colorFor(d.material)} strokeWidth="20"
                strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} />
            );
            offset += dash;
            return el;
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="13" fill="var(--color-text-quaternary)">{t("всего")}</text>
        <text x="80" y="94" textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--color-text-primary)">{(total / 1000).toFixed(1)}{t("кг")}</text>
      </svg>
      <div className="flex flex-col gap-1.5 text-sm">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: colorFor(d.material) }} />
            <span className="min-w-16 text-secondary">{d.material}</span>
            <span className="text-tertiary tabular-nums">{Math.round((d.grams / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATE_RU = {
  printing: [t("Печатает"), "in_use"],
  complete: [t("Завершена"), "added"],
  standby: [t("Ожидание"), ""],
  ready: [t("Готов"), ""],
  paused: [t("Пауза"), ""],
  error: [t("Ошибка"), "used"],
  cancelled: [t("Отменена"), "used"],
};

// Из сырого сообщения Klipper вытаскиваем понятную часть и код. Пример:
// "autoleve_panic_error:error: typ = WebRequestError, code = 10011902,
// message = Probe samples exceed samples_tolerance" → "Probe samples exceed
// samples_tolerance (код 10011902)". Формат вендорный — при непонятном виде
// возвращаем строку как есть.
function fmtPrinterError(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const human = s.match(/message\s*=\s*(.+)$/i)?.[1]?.trim();
  const code = s.match(/code\s*=\s*(\d+)/i)?.[1];
  // Код дописываем, только когда удалось вычленить отдельный текст, — иначе
  // на строке вида "code = 10237" вышло бы «code = 10237 (код 10237)».
  return human ? (code ? `${human} (${t("код")} ${code})` : human) : s;
}

// Распознанные ошибки прошивки. В API приходит текст, который прошивка Anycubic
// кладёт в сообщение Klipper (англоязычный — напр. "Probe samples exceed
// samples_tolerance"), а на экране принтера — пользовательский код Anycubic со
// своей страницей решения. Прямой таблицы «текст → экранный код» у Anycubic нет:
// re строим по характерному фрагменту сообщения (совпадает с заголовком страницы
// вики), code — экранный код Anycubic для ссылки на решение. Регэкспы намеренно
// узкие: промах безвреден (баннер уйдёт на поиск в Google), а ложное совпадение
// увело бы на чужую страницу. При новой реальной ошибке пару текст↔код сверять.
const KNOWN_PRINTER_ERRORS = [
  { re: /samples_tolerance|autoleve|auto[_\s-]?level/i, code: "10237", label: () => t("Ошибка автокалибровки стола") },
  { re: /extruder heating abnormal|heating abnormal/i,  code: "10122", label: () => t("Аномальный нагрев сопла") },
  { re: /nozzle must be heated/i,                       code: "10539", label: () => t("Сопло не нагрето") },
  { re: /filament broken/i,                             code: "10402", label: () => t("Филамент оборван") },
  { re: /abnormal filament/i,                           code: "10107", label: () => t("Проблема с филаментом") },
  { re: /clogging/i,                                    code: "11518", label: () => t("Засор филамента") },
  { re: /feeding timeout|abnormal feeding/i,            code: "11511", label: () => t("Таймаут подачи филамента") },
  { re: /abnormal material return|material return/i,    code: "11512", label: () => t("Ошибка возврата филамента") },
  { re: /unknown feed location/i,                       code: "11504", label: () => t("Филамент для подачи не выбран") },
  { re: /filament tangle|tangle detected/i,             code: "11519", label: () => t("Запутывание филамента в ACE") },
  { re: /color engine motor|rotation of the color/i,    code: "11521", label: () => t("Сбой мотора ACE") },
  { re: /unknown filament in filament tracker/i,        code: "11535", label: () => t("Неизвестный филамент в ACE") },
];

function recognizePrinterError(raw) {
  if (!raw) return null;
  return KNOWN_PRINTER_ERRORS.find((e) => e.re.test(raw)) || null;
}

// Официальная страница решения Anycubic по коду (модель-независимый вид —
// wiki.anycubic.com/en/error-codes/{code}-code — существует для всех кодов).
function anycubicWikiUrl(code) {
  return `https://wiki.anycubic.com/en/error-codes/${code}-code`;
}

// Фолбэк для незнакомых ошибок: поиск Google по бренду и тексту ошибки.
function errorSearchUrl(raw, brand) {
  const q = [brand, fmtPrinterError(raw)].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Ключ localStorage для «закрытого» пользователем баннера ошибки принтера.
const errDismissKey = (printerId) => `ft_err_dismiss_${printerId}`;

function fmtDur(sec) {
  if (sec == null) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} ${t("ч")} ${m} ${t("м")}`;
  if (m > 0) return `${m} ${t("м")}`;
  return `${sec} ${t("с")}`;
}

function fmtDryerRemaining(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


// Сколько ждём, пока принтер подтвердит включение/выключение сушки.
const DRYER_CONFIRM_MS = 30000;

function DryerControls({ printer, dryer, onChanged, row = false }) {
  const [temp, setTemp] = useState(45);
  const [hours, setHours] = useState(4);
  // Команда отправлена, но принтер её ещё не подтвердил: "start" | "stop" | null.
  const [pending, setPending] = useState(null);
  const [err, setErr] = useState(null);
  const [remainingSec, setRemainingSec] = useState(null);
  const drying = dryer?.status === "drying";
  const busy = pending !== null;

  useEffect(() => {
    if (!drying) return;
    if (dryer?.target_temp > 0) setTemp(dryer.target_temp);
    if (dryer?.remaining_min > 0) {
      setHours(Math.max(0.5, Math.round((dryer.remaining_min / 60) * 2) / 2));
    } else if (dryer?.duration_min > 0) {
      setHours(Math.max(0.5, Math.round((dryer.duration_min / 60) * 2) / 2));
    }
  }, [drying, dryer?.target_temp, dryer?.remaining_min, dryer?.duration_min]);

  useEffect(() => {
    if (!drying || !dryer?.remaining_min) {
      setRemainingSec(null);
      return undefined;
    }
    setRemainingSec(Math.max(0, Math.round(dryer.remaining_min * 60)));
    const timer = setInterval(() => {
      setRemainingSec((v) => (v == null ? v : Math.max(0, v - 1)));
    }, 1000);
    return () => clearInterval(timer);
  }, [drying, dryer?.remaining_min]);

  async function send(action) {
    setErr(null);
    setPending(action);
    try {
      await api.post(`/api/printers/${printer.id}/dryer`, {
        action,
        temp_c: Number(temp) || null,
        duration_min: Math.round((Number(hours) || 0) * 60) || null,
        unit: dryer?.unit ?? null,
      });
      // ACE применяет команду не мгновенно (обычно 3–10 с). Ждём не фиксированную
      // паузу, а подтверждения от принтера: иначе переключатель откатывается в
      // старое положение, и реальный статус приезжает только со slow-опроса (60 с).
      const deadline = Date.now() + DRYER_CONFIRM_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const o = await onChanged();
        if (!o) continue; // принтер не ответил — ждём следующей попытки
        const now = o.dryer?.status;
        // Выключение подтверждено любым состоянием, кроме "сушит" (в том числе
        // если хаб вовсе перестал отдавать сушилку), включение — только "drying".
        if (action === "start" ? now === "drying" : now !== "drying") return;
      }
      setErr(t("Принтер не подтвердил команду — проверьте сушилку на принтере"));
    } catch (e) {
      setErr(e.message);
    } finally {
      setPending(null);
    }
  }

  // Пока команда в пути, переключатель стоит в запрошенном положении, а не в
  // фактическом — иначе нажатие выглядит так, будто оно ничего не сделало.
  const switchOn = pending ? pending === "start" : drying;
  const remainingLabel = remainingSec != null ? fmtDryerRemaining(remainingSec) : null;
  const durationLabel = dryer?.duration_min > 0 ? fmtDryerRemaining(dryer.duration_min * 60) : null;

  const stateColor = pending ? "gray" : drying ? "brand" : dryer?.status === "heater_err" ? "error" : "gray";
  const stateText =
    pending === "start" ? t("включаем…")
    : pending === "stop" ? t("выключаем…")
    : drying ? t("Идёт сушка")
    : dryer?.status === "heater_err" ? t("ошибка нагревателя")
    : t("выключена");

  return (
    <div className={cx("flex gap-5", row ? "flex-col lg:flex-row lg:flex-wrap lg:items-end" : "flex-col")}>
      <div className="flex items-start justify-between gap-6 lg:min-w-64">
        <div>
          <p className="text-md font-semibold text-primary">{t("Сушка филамента")}</p>
          <div className="mt-1">
            <BadgeWithDot type="pill-color" size="sm" color={stateColor}>{stateText}</BadgeWithDot>
          </div>
        </div>
        <Toggle
          size="md"
          aria-label={drying ? t("Выключить") : t("Включить сушку")}
          isSelected={switchOn}
          isDisabled={busy}
          onChange={() => send(drying ? "stop" : "start")}
        />
      </div>

      {(drying || dryer?.humidity > 0) && (
        <div className="flex flex-wrap gap-2 lg:flex-1">
          {drying && (
            <>
              <Stat label={t("Температура")} className="min-w-24">{dryer.target_temp}°C</Stat>
              {durationLabel && <Stat label={t("Длительность")} className="min-w-24">{durationLabel}</Stat>}
              <Stat label={t("Осталось")} className="min-w-24">{remainingLabel || "—"}</Stat>
            </>
          )}
          {dryer?.humidity > 0 && <Stat label={t("Влажность")} className="min-w-24">{dryer.humidity}%</Stat>}
        </div>
      )}

      <div className="flex gap-3">
        <Input size="sm" type="number" label={t("Температура, °C")} value={String(temp)} onChange={setTemp} isDisabled={drying || busy} className="w-32" />
        <Input size="sm" type="number" label={t("Время, ч")} value={String(hours)} onChange={setHours} isDisabled={drying || busy} className="w-28" />
      </div>
      {err && <Notice tone="error" className="w-full">{err}</Notice>}
    </div>
  );
}

function MoonrakerCard({ printer, navigate, onTotals, sensors = [], humidityMax }) {
  const [status, setStatus] = useState(null);
  const [gates, setGates] = useState([]);
  const [gateSel, setGateSel] = useState(null); // номер гейта, у которого открыта привязка катушки
  const [directSlot, setDirectSlot] = useState(null); // слот прямой подачи (без MMU)
  const [feedChange, setFeedChange] = useState(null); // подача сменилась, катушки не подтверждены
  const [dryer, setDryer] = useState(null);
  const [light, setLight] = useState(null); // подсветка камеры, если ею можно управлять
  const [caps, setCaps] = useState(printer.capabilities || {});
  const [job, setJob] = useState(null);
  const [thumb, setThumb] = useState(null); // превью модели из метаданных задания
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Текст ошибки, который пользователь закрыл вручную (чтобы не мозолил глаза,
  // пока принтер держит state=error после уже решённой проблемы). Переживает
  // перезагрузку; сбрасывается, когда принтер выходит из ошибки, — тогда такая
  // же ошибка в будущем покажется снова.
  const [dismissedErr, setDismissedErr] = useState(() => {
    try { return localStorage.getItem(errDismissKey(printer.id)); } catch { return null; }
  });

  const loadOverview = () =>
    api.get(`/api/printers/${printer.id}/overview`).then((o) => {
      setStatus(o.status); setGates(o.gates || []); setDryer(o.dryer);
      setLight(o.light || null);
      setDirectSlot(o.direct_slot || null);
      setFeedChange(o.feed_change || null);
      setCaps(o.capabilities || {}); setOffline(false);
      onTotals?.(printer.id, o.totals);
      return o;
    }).catch(() => setOffline(true));

  // Последнее известное задание и признак «печатали в прошлый тик» — в ref,
  // чтобы быстрый интервал видел свежие значения без пересоздания эффекта.
  const jobRef = useRef(null);
  const wasPrintingRef = useRef(false);
  const watchUntilRef = useRef(0);

  const loadJob = () =>
    api.get(`/api/printers/${printer.id}/moonraker-jobs?limit=1`)
      .then((j) => {
        const was = jobRef.current;
        jobRef.current = j[0] || null;
        setJob(jobRef.current);
        // Печать только что списалась (авто-списание отработало в фоне) — остатки
        // катушек в слотах уже другие, не ждём минутного тика.
        const nowConsumed = jobRef.current?.consumed;
        if (was && nowConsumed && !(was.job_id === jobRef.current.job_id && was.consumed)) loadOverview();
      })
      .catch(() => {});

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    loadOverview(); loadJob();
    // Живые метрики: обычно часто тянем только статус, но во время сушки
    // перечитываем overview, потому что параметры ACE Dryer меняются на принтере.
    const fast = setInterval(() => {
      if (!visible()) return;
      if (dryer?.status === "drying") {
        loadOverview();
      } else {
        api.get(`/api/printers/${printer.id}/status`).then((s) => {
          setStatus(s);
          const printing = s?.state === "printing";
          // Печать только что завершилась — сразу показываем её в «Последней
          // печати» и открываем окно частого опроса, чтобы поймать авто-списание
          // (воркер списывает в фоне через ~30с) без перезагрузки страницы.
          if (wasPrintingRef.current && !printing) watchUntilRef.current = Date.now() + 180000;
          wasPrintingRef.current = printing;
          if (!printing && Date.now() < watchUntilRef.current && !jobRef.current?.consumed) {
            loadJob();
          }
        }).catch(() => {});
      }
    }, 7000);
    // Сушку могут запустить и с экрана принтера. Быстрый тик в этом состоянии
    // тянет только /status, где сушки нет, поэтому без отдельного наблюдателя
    // такой запуск всплыл бы лишь на slow-опросе — через минуту. Раз в 20 с
    // хватает, чтобы это не бросалось в глаза, и заметно дешевле, чем гонять
    // overview (status + hub) на каждом быстром тике. Пока сушка идёт, overview
    // и так перечитывается быстрым тиком, так что здесь ничего не делаем.
    const dryerWatch = dryer && setInterval(() => {
      if (visible() && dryer.status !== "drying") loadOverview();
    }, 20000);
    const slow = setInterval(() => {
      if (visible()) { loadOverview(); loadJob(); }
    }, 60000);
    return () => {
      clearInterval(fast); clearInterval(slow);
      if (dryerWatch) clearInterval(dryerWatch);
    };
  }, [printer.id, dryer?.status]);

  // Оборванную печать (отмена на принтере, ошибка) тоже списываем — по факту
  // выдавленной длины, если она есть.
  const jobInterrupted = job && job.status !== "completed" && job.status !== "in_progress";
  const canConsume =
    job && !job.consumed &&
    (job.status === "completed" || (jobInterrupted && job.filament_used_mm > 0));
  async function consume() {
    setErr(null); setBusy(true);
    try {
      const res = await api.post(`/api/printers/${printer.id}/moonraker-jobs/${encodeURIComponent(job.job_id)}/import`);
      navigate(`/print-jobs/${res.print_job_id}/consume`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const st = status?.state;
  // Подготовка (калибровка стола, хоминг, прогрев) идёт под state="printing",
  // но печатью ещё не является — показываем её отдельным состоянием.
  const isPreparing = !!status?.preparing;
  const [stLabel, stTag] = isPreparing
    ? [t("Подготовка"), "in_use"]
    : STATE_RU[st] || [st || "—", ""];
  const isPrinting = st === "printing" && !isPreparing;
  const isPaused = st === "paused";
  // «Пауза», за которой нет задания: прошивка защёлкнула print_stats после
  // ручных операций или оборванной печати. Продолжать и отменять там нечего —
  // CANCEL_PRINT молча ничего не делает, помогает только сброс состояния.
  const stuckPaused = isPaused && status?.is_paused === false && status?.sd_active === false;
  // Текст ошибки принтера: распознанный (описание + код + вики) либо сырой + гугл.
  const errMsg = st === "error" ? status?.message : null;
  const knownErr = recognizePrinterError(errMsg);
  const showError = errMsg && errMsg !== dismissedErr;

  // Принтер вышел из ошибки — забываем ручное закрытие.
  useEffect(() => {
    if (status && st !== "error" && dismissedErr) {
      setDismissedErr(null);
      try { localStorage.removeItem(errDismissKey(printer.id)); } catch { /* ignore */ }
    }
  }, [st, status, dismissedErr, printer.id]);

  function dismissError() {
    setDismissedErr(errMsg);
    try { localStorage.setItem(errDismissKey(printer.id), errMsg); } catch { /* ignore */ }
  }

  // Сброс на принтере: шлём SDCARD_RESET_FILE, print_stats возвращается в
  // standby, и состояние исчезает по-настоящему (а не скрывается локально).
  async function sendReset() {
    setErr(null); setBusy(true);
    try {
      await api.post(`/api/printers/${printer.id}/reset-error`);
      await loadOverview();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function resetError() {
    if (!window.confirm(t("Отправить принтеру команду сброса ошибки? Состояние вернётся в «Ожидание»."))) return;
    await sendReset();
  }

  async function resetStuck() {
    if (!window.confirm(t("Сбросить залипшее состояние? Принтер вернётся в «Ожидание», задание будет забыто."))) return;
    await sendReset();
  }

  // Пауза, продолжение и отмена текущей печати. Команду выполняет прошивка
  // (макросы отвода головы), поэтому ответ приходит не мгновенно; свежий статус
  // бэкенд отдаёт вместе с ответом, чтобы кнопки переключились сразу.
  async function printControl(action) {
    if (action === "cancel" && !window.confirm(t("Остановить печать? Отменённое задание продолжить нельзя."))) return;
    setErr(null); setBusy(true);
    try {
      const res = await api.post(`/api/printers/${printer.id}/print-control`, { action });
      if (res?.status) setStatus(res.status);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const filePath = status?.filename || job?.filename || "";
  const file = filePath.split("/").pop();

  // Превью тянем отдельно и только при смене файла: картинка весит килобайты и
  // для файла неизменна, а статус опрашивается каждые 7 секунд.
  useEffect(() => {
    if (!filePath) { setThumb(null); return; }
    let alive = true;
    api.get(`/api/printers/${printer.id}/thumbnail?filename=${encodeURIComponent(filePath)}`)
      .then((r) => { if (alive) setThumb(r?.thumbnail?.data_url || null); })
      .catch(() => { if (alive) setThumb(null); });
    return () => { alive = false; };
  }, [printer.id, filePath]);

  const pct = status?.progress != null ? Math.round(status.progress * 100) : null;
  const elapsed = status?.print_duration_sec;
  // Остаток берём у прошивки — она знает план печати, а не экстраполирует.
  // Оценка по прогрессу остаётся запасным вариантом: на других принтерах
  // remain_time может не приходить, а в начале печати она ещё и врёт.
  const remaining = !isPrinting
    ? null
    : status?.remaining_sec > 0
      ? status.remaining_sec
      : status?.progress > 0.02 && elapsed != null
        ? elapsed * (1 / status.progress - 1)
        : null;
  const layer = status?.current_layer;
  const totalLayer = status?.total_layer;

  // Секции карточки — по возможностям принтера (авто из overview + пресет).
  const hasMmu = caps.has_mmu ?? gates.length > 0;
  const mmuTitle = caps.mmu_name ? `${t("Слоты")} ${caps.mmu_name}` : t("Слоты мультиподачи");
  // Прямая подача: вместо гейтов показываем единственную катушку с держателя.
  const showDirect = !hasMmu && !!directSlot;
  // Гейт мог исчезнуть из сводки (хаб сняли), пока был открыт — тогда редактор просто не рисуем.
  const selGate = gates.find((g) => g.gate === gateSel);
  const accent = brandAccent(printer.brand);

  const zoneTitle = isPreparing ? t("Подготовка к печати") : isPrinting ? t("Печатается") : isPaused ? t("Печать на паузе") : t("Последняя печать");
  const tempText = (v, target) => `${v != null ? Math.round(v) + "°" : "—"}${target > 0 ? ` / ${Math.round(target)}°` : ""}`;
  const hasZone2 = hasMmu || showDirect || sensors.length > 0;
  const consumeTitle =
    job?.consumed ? t("По этой печати материал уже списан")
    : canConsume && jobInterrupted ? t("Печать прервана — списать фактически израсходованное")
    : canConsume ? t("Списать материал по этой печати")
    : t("Доступно после завершения печати");

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-secondary px-5 py-4">
          <PrinterArt caps={caps} brand={printer.brand} model={printer.model} size={48} />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-md font-semibold text-primary">{printer.name}</h3>
            {(printer.brand || printer.model) && (
              <p className="truncate text-sm text-tertiary">{[printer.brand, printer.model].filter(Boolean).join(" ")}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!offline && <LightToggle printerId={printer.id} light={light} onChanged={loadOverview} onError={setErr} />}
            {job?.consumed && <Badge size="sm" color="success" type="pill-color">{t("Списано")}</Badge>}
            {offline
              ? <BadgeWithDot type="pill-color" size="sm" color="error">{t("не в сети")}</BadgeWithDot>
              : status && <StateBadge tag={stTag}>{stLabel}</StateBadge>}
          </div>
        </div>

        <div className="p-5">
          {offline ? (
            <p className="text-sm text-tertiary">{t("Не удалось связаться с принтером.")}</p>
          ) : (
            <div className="flex flex-col gap-5">
              {showError && fmtPrinterError(errMsg) && (
                <Notice
                  tone="error"
                  title={knownErr ? knownErr.label() : fmtPrinterError(errMsg)}
                  onClose={dismissError}
                  actions={
                    <>
                      {knownErr ? (
                        <a className="underline" href={anycubicWikiUrl(knownErr.code)} target="_blank" rel="noopener noreferrer">{t("решение ↗")}</a>
                      ) : (
                        <a className="underline" href={errorSearchUrl(errMsg, printer.brand)} target="_blank" rel="noopener noreferrer">{t("искать в Google ↗")}</a>
                      )}
                      <AriaButton className="cursor-pointer bg-transparent underline" onPress={resetError} isDisabled={busy} aria-label={t("Сбросить ошибку на принтере")}>{t("Сбросить")}</AriaButton>
                    </>
                  }
                >
                  {knownErr ? `${printer.brand || "Anycubic"} ${knownErr.code} · ${fmtPrinterError(errMsg)}` : null}
                </Notice>
              )}
              {feedChange && (
                <FeedChangeBanner printer={printer} change={feedChange} onConfirmed={loadOverview} />
              )}

              <div className={cx("grid gap-6", hasZone2 && "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
                {/* Блок «Печать» */}
                <div className="flex min-w-0 flex-col">
                  <ZoneTitle>{zoneTitle}</ZoneTitle>
                  <div className="flex items-center gap-3">
                    {thumb && <img className="h-14 w-[4.5rem] shrink-0 rounded-lg object-cover ring-1 ring-secondary ring-inset" src={thumb} alt="" title={file} />}
                    <div className="min-w-0 flex-1 truncate rounded-lg bg-secondary px-3 py-2 font-mono text-sm text-secondary" title={file}>
                      {file || t("нет данных")}
                    </div>
                  </div>

                  {stuckPaused && (
                    <Notice tone="warning" className="mt-3">
                      {t("Принтер держит паузу, но задания за ней нет: продолжать и отменять нечего — поможет «Сбросить».")}
                    </Notice>
                  )}

                  {isPreparing ? (
                    <>
                      <p className="mt-4 mb-2 text-sm text-secondary">{t("Калибровка стола и прогрев — печать ещё не началась")}</p>
                      {/* Прогресс неизвестен — бегунок вместо шкалы. */}
                      <div className="h-2 overflow-hidden rounded-full bg-quaternary" role="progressbar" aria-label={t("Калибровка стола и прогрев — печать ещё не началась")}>
                        <div className="h-full w-[35%] animate-progress-slide rounded-full bg-brand-solid" />
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <Stat label={t("Слоёв в задании")}>{totalLayer || "—"}</Stat>
                        <Stat label={t("Сопло")}>{tempText(status?.nozzle_temp, status?.nozzle_target)}</Stat>
                        <Stat label={t("Стол")}>{tempText(status?.bed_temp, status?.bed_target)}</Stat>
                      </div>
                    </>
                  ) : isPrinting || isPaused ? (
                    <>
                      <div className="mt-4 mb-2 flex items-baseline justify-between gap-3">
                        <span className="text-display-xs font-semibold tracking-tight text-primary tabular-nums">{pct != null ? pct + "%" : "—"}</span>
                        <span className="text-sm text-tertiary">
                          {isPaused ? t("печать приостановлена") : `${t("осталось ~")}${remaining != null ? fmtDur(remaining) : t("считаем…")}`}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-quaternary">
                        <div className="h-full rounded-full bg-brand-solid transition-[width] duration-500" style={{ width: `${pct || 0}%` }} />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Stat label={t("Прошло")}>{fmtDur(elapsed)}</Stat>
                        <Stat label={t("Слой")}>{layer > 0 && totalLayer > 0 ? `${layer} / ${totalLayer}` : "—"}</Stat>
                        <Stat label={t("Сопло")}>{tempText(status?.nozzle_temp, status?.nozzle_target)}</Stat>
                        <Stat label={t("Стол")}>{tempText(status?.bed_temp, status?.bed_target)}</Stat>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <Stat label={t("Расход")}>{job?.filament_total_g != null ? `${Number(job.filament_total_g).toFixed(0)} ${t("г")}` : "—"}</Stat>
                      <Stat label={t("Цена")}>{job?.cost != null ? fmtMoney(job.cost, job.cost_currency) : "—"}</Stat>
                      <Stat label={t("Статус")}>{job?.consumed ? t("списано") : job?.status === "completed" ? t("ждёт списания") : job?.status || "—"}</Stat>
                    </div>
                  )}

                  {err && <Notice tone="error" className="mt-3">{err}</Notice>}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                    {/* Управление печатью — только пока есть что паузить или отменять. */}
                    {(isPrinting || isPreparing || isPaused) && (
                      <>
                        <Button
                          size="sm"
                          color="secondary"
                          iconLeading={isPaused ? PlayCircle : PauseCircle}
                          isDisabled={busy}
                          onClick={() => printControl(isPaused ? "resume" : "pause")}
                        >
                          {isPaused ? t("Продолжить") : t("На паузу")}
                        </Button>
                        <Button size="sm" color="secondary-destructive" iconLeading={StopCircle} isDisabled={busy} onClick={() => printControl("cancel")}>
                          {t("Остановить")}
                        </Button>
                        {stuckPaused && (
                          <Button size="sm" color="secondary" isDisabled={busy} onClick={resetStuck}>{t("Сбросить")}</Button>
                        )}
                      </>
                    )}
                    <span title={consumeTitle}>
                      <Button size="sm" color="primary" isDisabled={!canConsume || busy} onClick={consume}>
                        {job?.consumed ? t("Списано ✓") : canConsume && jobInterrupted ? t("Списать по факту") : t("Списать")}
                      </Button>
                    </span>
                    <Button size="sm" color="link-color" onClick={() => navigate(`/printers?moonraker=${printer.id}`)}>{t("Завершённые задания →")}</Button>
                  </div>
                </div>

                {/* Блок «Слоты» — только если у принтера мультиподача. Показания
                    датчика идут прямо под слотами: он лежит внутри самого ACE, так
                    что это микроклимат тех катушек, что видно в слотах выше. */}
                {hasZone2 && (
                  <div className="min-w-0 lg:border-l lg:border-secondary lg:pl-6">
                    {hasMmu && (
                      <>
                        <ZoneTitle>{mmuTitle}</ZoneTitle>
                        <GateChips
                          gates={gates}
                          selected={gateSel}
                          onSelect={(n) => setGateSel((cur) => (cur === n ? null : n))}
                        />
                        {selGate && (
                          <GateEditor printer={printer} gate={selGate} onChanged={loadOverview} onClose={() => setGateSel(null)} />
                        )}
                      </>
                    )}
                    {showDirect && (
                      <>
                        <ZoneTitle>
                          {directSlot?.slot_index === 0 ? t("Внешняя катушка") : t("Прямая подача")}
                          {caps.mmu_off && (
                            <span className="font-normal normal-case"> · {caps.mmu_name || t("мультиподача")} {t("отключена")}</span>
                          )}
                        </ZoneTitle>
                        <DirectFeed slot={directSlot} printerId={printer.id} navigate={navigate} />
                      </>
                    )}
                    {sensors.length > 0 && (
                      <div className={cx((hasMmu || showDirect) && "mt-5 border-t border-secondary pt-4")}>
                        {!hasMmu && !showDirect && <ZoneTitle>{t("Микроклимат")}</ZoneTitle>}
                        <div className="flex flex-col gap-2">
                          {sensors.map((s) => (
                            <EnvSensor key={s.id} sensor={s} threshold={humidityMax} spread showName={sensors.length > 1} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
      {!offline && dryer && (
        <Card className="p-5">
          <DryerControls printer={printer} dryer={dryer} onChanged={loadOverview} row />
        </Card>
      )}
    </>
  );
}

// Единственная катушка прямой подачи — замена плиткам гейтов, когда
// мультиподача снята (или её у принтера нет). Показывает то же, что и гейт:
// цвет, материал и что осталось.
function DirectFeed({ slot, printerId, navigate }) {
  const spool = slot?.spool;
  const grams = spool?.current_weight_g;
  const go = () => navigate(spool ? `/spools/${spool.id}` : `/printers?slots=${printerId}`);
  return (
    <div
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-xl p-3 outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2",
        spool ? "ring-1 ring-secondary ring-inset" : "border border-dashed border-primary",
      )}
      role="button"
      tabIndex={0}
      title={spool ? t("Открыть катушку") : t("Назначить катушку на слот")}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
    >
      <SpoolSwatch color={spool?.color_hex} size="md" className="rounded-full" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-primary">
          {spool ? (spool.material || t("Материал не указан")) : t("Катушка не назначена")}
        </p>
        <p className="truncate text-sm text-tertiary">
          {spool
            ? [spool.color_name || spool.label, grams != null ? `${Math.round(grams)} ${t("г")}` : null].filter(Boolean).join(" · ")
            : `${slotLabel(slot) || t("Внешняя катушка")} — ${t("привязать в разделе «Принтеры»")}`}
        </p>
      </div>
      <Disc01 className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
    </div>
  );
}

// Блок «Ресурс принтера» — статистика за всё время. Вынесен из карточки принтера,
// чтобы показываться отдельным блоком в общем потоке дашборда.
function PrinterLifetime({ totals, name }) {
  if (!totals) return null;
  return (
    <section>
      <div className="mb-3">
        <h3 className="m-0 text-md font-semibold text-primary">{t("Ресурс принтера")}</h3>
        <p className="text-sm text-tertiary">{name || t("Статистика за всё время")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label={t("Всего печатей")} value={totals.total_jobs} hint={t("завершённых заданий")} />
        <MetricCard label={t("Время печати")} value={Math.round((totals.total_print_time_sec || 0) / 3600)} hint={t("ч печати")} />
        <MetricCard label={t("Филамент")} value={((totals.total_filament_mm || 0) / 1e6).toFixed(2)} hint={t("км филамента")} />
      </div>
    </section>
  );
}

const ACT_TYPE = () => ({
  used: ["gray", t("Расход")],
  added: ["success", t("Добавлено")],
  updated: ["gray", t("Изменено")],
  moved: ["brand", t("Перемещено")],
});

const linkCls = "text-sm font-semibold text-brand-secondary hover:text-brand-secondary_hover";

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [mrPrinters, setMrPrinters] = useState([]);
  const [lifetimes, setLifetimes] = useState({}); // printerId -> totals (поднято из карточек)
  const navigate = useNavigate();
  const onTotals = (id, totals) => setLifetimes((prev) => ({ ...prev, [id]: totals }));
  const { sensors, humidity_alert_max_pct: humidityMax } = useEnvSensors();
  // Привязанные к принтеру показываются на его карточке, остальные — общим
  // блоком: дублировать один и тот же датчик в двух местах смысла нет.
  const sensorsFor = (printerId) =>
    sensors.filter((s) => s.bind_type === "printer" && s.bind_id === printerId);
  const looseSensors = sensors.filter((s) => s.bind_type !== "printer");

  useEffect(() => {
    api.get("/api/dashboard").then(setD).catch(() => {});
    api.get("/api/printers").then((ps) => setMrPrinters(ps.filter((p) => p.integration_type === "moonraker"))).catch(() => {});
  }, []);
  if (!d) return <div>{t("Загрузка…")}</div>;

  // Единая палитра материалов для обоих графиков дашборда: цвет закреплён за
  // материалом, а не за позицией, — столбики расхода и пончик распределения
  // читаются одним ключом. Порядок — по суммарному расходу (крупный в основании).
  const matTotals = {};
  (d.monthly_usage || []).forEach((mth) =>
    Object.entries(mth.by_material || {}).forEach(([m, g]) => { matTotals[m] = (matTotals[m] || 0) + g; })
  );
  (d.material_distribution || []).forEach((x) => { if (!(x.material in matTotals)) matTotals[x.material] = 0; });
  const matOrder = Object.keys(matTotals).sort((a, b) => (matTotals[b] - matTotals[a]) || a.localeCompare(b));
  const colorFor = (m) => MAT_COLORS[Math.max(0, matOrder.indexOf(m)) % MAT_COLORS.length];
  const barMaterials = matOrder.filter((m) => matTotals[m] > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader className="mb-0 lg:mb-0" title={t("Панель")} subtitle={t("Обзор запасов филамента и недавней активности.")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("Всего катушек")} value={d.total_spools} hint={`+${d.added_this_month} ${t("в этом месяце")}`} />
        <MetricCard label={t("Заканчиваются")} value={d.low_stock_count} hint={t("Требуют внимания")} tone={d.low_stock_count > 0 ? "warning" : undefined} />
        <MetricCard label={t("Остаток филамента")} value={`${(d.est_filament_left_g / 1000).toFixed(1)} ${t("кг")}`} hint={`~${d.est_print_hours} ${t("ч печати")}`} />
        <MetricCard
          label={t("Печатей (30 дн)")}
          value={d.recent_prints_30d}
          hint={`${(d.consumed_30d_g / 1000).toFixed(1)} ${t("кг израсходовано")}${d.consumed_30d_cost != null ? ` · ${fmtMoney(d.consumed_30d_cost, d.cost_currency)}` : ""}${d.failed_30d ? ` · ${t("брак")} ${d.failed_30d}` : ""}`}
        />
      </div>

      {mrPrinters.length > 0 && (
        <div className="flex flex-col gap-4">
          {mrPrinters.map((p) => (
            <MoonrakerCard
              key={p.id}
              printer={p}
              navigate={navigate}
              onTotals={onTotals}
              sensors={sensorsFor(p.id)}
              humidityMax={humidityMax}
            />
          ))}
        </div>
      )}

      {looseSensors.length > 0 && (
        <Card>
          <CardHeader title={t("Условия хранения")} description={t("по датчикам Home Assistant")} />
          <div className="divide-y divide-secondary px-5">
            {looseSensors.map((s) => (
              <div key={s.id} className="py-3"><EnvSensor sensor={s} threshold={humidityMax} row /></div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Расход по месяцам")} />
          <div className="p-5"><BarChart data={d.monthly_usage} materials={barMaterials} colorFor={colorFor} /></div>
        </Card>
        <Card>
          <CardHeader title={t("Распределение по материалам")} />
          <div className="p-5">
            {d.material_distribution.length ? <Donut data={d.material_distribution} colorFor={colorFor} /> : <p className="text-sm text-tertiary">{t("Нет данных")}</p>}
          </div>
        </Card>
      </div>

      <div className={cx("grid gap-4", d.drying_alerts?.length > 0 && "lg:grid-cols-2")}>
        {/* Низкий остаток + быстрое добавление. */}
        <Card className="flex flex-col">
          <CardHeader
            title={t("Быстрые действия и уведомления")}
            badge={d.low_stock.length > 0 ? <Badge size="sm" color="warning" type="pill-color">{d.low_stock.length}</Badge> : null}
          />
          <div className="flex-1 p-5">
            {d.low_stock.length === 0 ? (
              <Notice tone="success" title={t("Всё в порядке")}>
                {t("Нет катушек с низким остатком.")}{" "}
                <Link to="/spools" className="font-semibold underline">{t("Все катушки →")}</Link>
              </Notice>
            ) : (
              <div className="flex flex-col gap-4">
                {d.low_stock.slice(0, 3).map((s) => (
                  <div key={s.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-primary">{s.name}</p>
                        <p className="truncate text-sm text-tertiary">{s.sub}</p>
                      </div>
                      <Badge size="sm" color={s.remaining_g > 0 ? "warning" : "error"} type="pill-color">{s.remaining_g}{" "}{t("г")}</Badge>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-quaternary">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round(s.pct * 100))}%`, background: "var(--color-utility-red-500, #f04438)" }} />
                    </div>
                  </div>
                ))}
                {d.low_stock.length > 3 && <Link to="/spools" className={linkCls}>{t("Весь инвентарь →")}</Link>}
              </div>
            )}
          </div>
          <div className="px-5 pb-5">
            <Button size="md" color="secondary" iconLeading={Plus} className="w-full" onClick={() => navigate("/spools/new")}>
              {t("Добавить катушку")}
            </Button>
          </div>
        </Card>

        {d.drying_alerts?.length > 0 && (
          <Card>
            <CardHeader title={t("Пора просушить")} />
            <div className="divide-y divide-secondary px-5">
              {d.drying_alerts.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link to={`/spools/${a.id}`} className="block truncate text-sm font-medium text-primary hover:text-brand-secondary">{a.name}</Link>
                    <p className="text-sm text-tertiary">{a.material}</p>
                  </div>
                  <Badge size="sm" color="warning" type="pill-color">{a.days} {t("дн")}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {mrPrinters.map((p) => lifetimes[p.id] && (
        <PrinterLifetime key={p.id} totals={lifetimes[p.id]} name={mrPrinters.length > 1 ? p.name : undefined} />
      ))}

      <Card>
        <CardHeader title={t("Недавняя активность")} actions={<Link to="/print-jobs" className={linkCls}>{t("Вся история →")}</Link>} />
        <div className="divide-y divide-secondary px-5">
          {d.recent_activity.slice(0, 3).map((a, i) => {
            const neg = a.amount && a.amount.startsWith("-");
            const pos = a.amount && a.amount.startsWith("+");
            const [tone, label] = ACT_TYPE()[a.type] || ["gray", a.type];
            return (
              <div className="flex items-center justify-between gap-4 py-3" key={i}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-primary">{a.name}</span>
                    <Badge size="sm" color={tone} type="pill-color">{label}</Badge>
                  </div>
                  <p className="truncate text-sm text-tertiary">{tReason(a.sub)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cx("text-sm font-semibold tabular-nums", neg ? "text-error-primary" : pos ? "text-success-primary" : "text-primary")}>{a.amount || "—"}</p>
                  <p className="text-sm text-tertiary">{timeAgo(a.created_at)}</p>
                </div>
              </div>
            );
          })}
          {d.recent_activity.length === 0 && <p className="py-6 text-sm text-tertiary">{t("Пока нет активности")}</p>}
        </div>
      </Card>
    </div>
  );
}
