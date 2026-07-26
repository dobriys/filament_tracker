import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, tReason } from "../i18n.js";
import { GateChips } from "../components/HubGates.jsx";
import { PrinterArt, brandAccent } from "../components/PrinterArt.jsx";
import EnvSensor, { useEnvSensors } from "../components/EnvSensor.jsx";
import Icon from "../components/Icon.jsx";

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
              <line x1={padL} y1={y} x2={W} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{Math.round(niceMax * tk)}</text>
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
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{t(d.label)}</text>
            </g>
          );
        })}
      </svg>
      {materials.length > 0 && (
        <div className="bar-legend">
          {materials.map((m) => (
            <span key={m} className="bar-legend-item"><i style={{ background: colorFor(m) }} />{m}</span>
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
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
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
        <text x="80" y="76" textAnchor="middle" fontSize="13" fill="var(--muted)">{t("всего")}</text>
        <text x="80" y="94" textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--text)">{(total / 1000).toFixed(1)}{t("кг")}</text>
      </svg>
      <div style={{ fontSize: 13 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: colorFor(d.material) }} />
            <span style={{ minWidth: 60 }}>{d.material}</span>
            <span className="muted">{Math.round((d.grams / total) * 100)}%</span>
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

function Temp({ label, t, target }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {t != null ? Math.round(t) + "°" : "—"}
        {target != null && target > 0 && <span className="muted" style={{ fontWeight: 400 }}> / {Math.round(target)}°</span>}
      </div>
    </div>
  );
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

  return (
    <div className={`dryer-control${row ? " dryer-row-control" : ""}`}>
      <div className="dryer-head">
        <div>
          <div className="dryer-title">{t("Сушка филамента")}</div>
          <div className={`dryer-state ${drying ? "on" : ""} ${pending ? "pending" : ""} ${dryer?.status === "heater_err" ? "error" : ""}`}>
            <span />
            {pending === "start" ? t("включаем…")
              : pending === "stop" ? t("выключаем…")
              : drying ? t("Идёт сушка")
              : dryer?.status === "heater_err" ? t("ошибка нагревателя")
              : t("выключена")}
          </div>
        </div>
        <button
          type="button"
          className={`apple-switch ${switchOn ? "on" : ""} ${pending ? "pending" : ""}`}
          role="switch"
          aria-checked={switchOn}
          aria-busy={busy}
          aria-label={drying ? t("Выключить") : t("Включить сушку")}
          title={drying ? t("Выключить") : t("Включить сушку")}
          disabled={busy}
          onClick={() => send(drying ? "stop" : "start")}
        >
          <span />
        </button>
      </div>

      {(drying || dryer?.humidity > 0) && (
        <div className="dryer-live-panel">
          {drying && (
            <>
              <div className="dryer-live-metric">
                <span>{t("Температура")}</span>
                <b>{dryer.target_temp}°C</b>
              </div>
              {durationLabel && (
                <div className="dryer-live-metric">
                  <span>{t("Длительность")}</span>
                  <b>{durationLabel}</b>
                </div>
              )}
              <div className="dryer-live-metric">
                <span>{t("Осталось")}</span>
                <b>{remainingLabel || "—"}</b>
              </div>
            </>
          )}
          {dryer?.humidity > 0 && (
            <div className="dryer-live-metric">
              <span>{t("Влажность")}</span>
              <b>{dryer.humidity}%</b>
            </div>
          )}
        </div>
      )}

      <div className="dryer-fields">
        <div>
          <label>{t("Температура, °C")}</label>
          <input type="number" min="35" max="70" value={temp} onChange={(e) => setTemp(e.target.value)} disabled={drying || busy} />
        </div>
        <div>
          <label>{t("Время, ч")}</label>
          <input type="number" min="0.5" max="24" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} disabled={drying || busy} />
        </div>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function MoonrakerCard({ printer, navigate, onTotals, sensors = [], humidityMax }) {
  const [status, setStatus] = useState(null);
  const [gates, setGates] = useState([]);
  const [directSlot, setDirectSlot] = useState(null); // слот прямой подачи (без MMU)
  const [dryer, setDryer] = useState(null);
  const [caps, setCaps] = useState(printer.capabilities || {});
  const [job, setJob] = useState(null);
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
      setDirectSlot(o.direct_slot || null);
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
      .then((j) => { jobRef.current = j[0] || null; setJob(jobRef.current); })
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
  // standby, и ошибка исчезает по-настоящему (а не скрывается локально).
  async function resetError() {
    if (!window.confirm(t("Отправить принтеру команду сброса ошибки? Состояние вернётся в «Ожидание»."))) return;
    setErr(null); setBusy(true);
    try {
      await api.post(`/api/printers/${printer.id}/reset-error`);
      await loadOverview();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const file = (status?.filename || job?.filename || "").split("/").pop();
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
  const accent = brandAccent(printer.brand);

  return (
    <>
    <div className="card moonraker-card" style={{ "--brand": accent }}>
      <div className="printer-head">
        <PrinterArt caps={caps} brand={printer.brand} model={printer.model} size={62} />
        <div className="printer-head-main">
          <h3>{printer.name}</h3>
        </div>
        <div className="printer-head-status">
          {job?.consumed && <span className="badge added">{t("Списано")}</span>}
          {offline ? <span className="badge used">{t("не в сети")}</span> : status && <span className={`act-tag ${stTag}`}>{stLabel}</span>}
        </div>
      </div>

      {offline ? (
        <div className="muted">{t("Не удалось связаться с принтером.")}</div>
      ) : (
        <>
          {showError && fmtPrinterError(errMsg) && (
            <div className="printer-error" title={errMsg}>
              <div className="printer-error-main">
                <span>
                  <Icon name="alert" size={14} /> {knownErr ? knownErr.label() : fmtPrinterError(errMsg)}
                  {knownErr && <b className="printer-error-code"> · {printer.brand || "Anycubic"} {knownErr.code}</b>}
                </span>
                <span className="printer-error-actions">
                  {knownErr ? (
                    <a href={anycubicWikiUrl(knownErr.code)} target="_blank" rel="noopener noreferrer">{t("решение ↗")}</a>
                  ) : (
                    <a href={errorSearchUrl(errMsg, printer.brand)} target="_blank" rel="noopener noreferrer">{t("искать в Google ↗")}</a>
                  )}
                  <button className="printer-error-reset" onClick={resetError} disabled={busy} title={t("Сбросить ошибку на принтере")}>{t("Сбросить")}</button>
                  <button className="printer-error-close" onClick={dismissError} title={t("Скрыть")} aria-label={t("Скрыть")}>×</button>
                </span>
              </div>
              {knownErr && <div className="printer-error-raw">{fmtPrinterError(errMsg)}</div>}
            </div>
          )}
          <div className="printer-grid">
            {/* Блок «Печать» */}
            <div className="printer-zone">
              <div className="zone-title">{isPreparing ? t("Подготовка к печати") : isPrinting ? t("Печатается") : t("Последняя печать")}</div>
              <div className="zone-file-box" title={file}>{file || t("нет данных")}</div>
              {isPreparing ? (
                <>
                  <div style={{ margin: "10px 0 6px", fontSize: 15 }}>
                    {t("Калибровка стола и прогрев — печать ещё не началась")}
                  </div>
                  <div className="progress"><div className="progress-indeterminate" style={{ background: "var(--accent)" }} /></div>
                  <div className="zone-metrics">
                    <div><span className="muted">{t("Слоёв в задании")}</span><b className="mono">{totalLayer || "—"}</b></div>
                    <div><span className="muted">{t("Сопло")}</span><b className="mono">{status?.nozzle_temp != null ? Math.round(status.nozzle_temp) + "°" : "—"}{status?.nozzle_target > 0 ? ` / ${Math.round(status.nozzle_target)}°` : ""}</b></div>
                    <div><span className="muted">{t("Стол")}</span><b className="mono">{status?.bed_temp != null ? Math.round(status.bed_temp) + "°" : "—"}{status?.bed_target > 0 ? ` / ${Math.round(status.bed_target)}°` : ""}</b></div>
                  </div>
                </>
              ) : isPrinting ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "10px 0 6px" }}>
                    <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{pct != null ? pct + "%" : "—"}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{t("осталось ~")}{remaining != null ? fmtDur(remaining) : t("считаем…")}</span>
                  </div>
                  <div className="progress"><div style={{ width: `${pct || 0}%`, background: "var(--accent)" }} /></div>
                  <div className="zone-metrics">
                    <div><span className="muted">{t("Прошло")}</span><b className="mono">{fmtDur(elapsed)}</b></div>
                    <div><span className="muted">{t("Слой")}</span><b className="mono">{layer > 0 && totalLayer > 0 ? `${layer} / ${totalLayer}` : "—"}</b></div>
                    <div><span className="muted">{t("Сопло")}</span><b className="mono">{status?.nozzle_temp != null ? Math.round(status.nozzle_temp) + "°" : "—"}{status?.nozzle_target > 0 ? ` / ${Math.round(status.nozzle_target)}°` : ""}</b></div>
                    <div><span className="muted">{t("Стол")}</span><b className="mono">{status?.bed_temp != null ? Math.round(status.bed_temp) + "°" : "—"}{status?.bed_target > 0 ? ` / ${Math.round(status.bed_target)}°` : ""}</b></div>
                  </div>
                </>
              ) : (
                <div className="zone-metrics" style={{ marginTop: 10 }}>
                  <div><span className="muted">{t("Расход")}</span><b className="mono">{job?.filament_total_g != null ? `${Number(job.filament_total_g).toFixed(0)} ${t("г")}` : "—"}</b></div>
                  <div><span className="muted">{t("Цена")}</span><b className="mono">{job?.cost != null ? fmtMoney(job.cost, job.cost_currency) : "—"}</b></div>
                  <div><span className="muted">{t("Статус")}</span><b>{job?.consumed ? t("списано") : job?.status === "completed" ? t("ждёт списания") : job?.status || "—"}</b></div>
                </div>
              )}
              {err && <div className="error">{err}</div>}
              <div className="printer-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto", paddingTop: 14 }}>
                <button
                  onClick={consume}
                  disabled={!canConsume || busy}
                  title={
                    job?.consumed ? t("По этой печати материал уже списан")
                    : canConsume && jobInterrupted ? t("Печать прервана — списать фактически израсходованное")
                    : canConsume ? t("Списать материал по этой печати")
                    : t("Доступно после завершения печати")
                  }
                >
                  {job?.consumed ? t("Списано ✓") : canConsume && jobInterrupted ? t("Списать по факту") : t("Списать")}
                </button>
                <button className="secondary" onClick={() => navigate(`/printers?moonraker=${printer.id}`)}>{t("Завершённые задания →")}</button>
              </div>
            </div>

            {/* Блок «Слоты» — только если у принтера мультиподача. Показания
                датчика идут прямо под слотами: он лежит внутри самого ACE, так
                что это микроклимат тех катушек, что видно в слотах выше. */}
            {(hasMmu || showDirect || sensors.length > 0) && (
              <div className="printer-zone">
                {hasMmu && (
                  <>
                    <div className="zone-title">{mmuTitle}</div>
                    <GateChips gates={gates} />
                  </>
                )}
                {showDirect && (
                  <>
                    <div className="zone-title">
                      {t("Прямая подача")}
                      {caps.mmu_off && (
                        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                          {" · "}{caps.mmu_name || t("мультиподача")} {t("отключена")}
                        </span>
                      )}
                    </div>
                    <DirectFeed slot={directSlot} printerId={printer.id} navigate={navigate} />
                  </>
                )}
                {sensors.length > 0 && (
                  <div className={`zone-env${hasMmu || showDirect ? "" : " zone-env--bare"}`}>
                    {!hasMmu && !showDirect && <div className="zone-title">{t("Микроклимат")}</div>}
                    {sensors.map((s) => (
                      <EnvSensor key={s.id} sensor={s} threshold={humidityMax} spread showName={sensors.length > 1} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
    {!offline && dryer && (
      <div className="card dryer-row">
        <DryerControls printer={printer} dryer={dryer} onChanged={loadOverview} row />
      </div>
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
  return (
    <div
      className={`direct-feed${spool ? "" : " direct-feed--empty"}`}
      role="button"
      tabIndex={0}
      title={spool ? t("Открыть катушку") : t("Назначить катушку на слот")}
      onClick={() => navigate(spool ? `/spools/${spool.id}` : `/printers?slots=${printerId}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(spool ? `/spools/${spool.id}` : `/printers?slots=${printerId}`)}
    >
      <div
        className="direct-feed-swatch"
        style={{ background: spool?.color_hex || "var(--panel-2)" }}
      />
      <div className="direct-feed-body">
        <div className="direct-feed-title">
          {spool ? (spool.material || t("Материал не указан")) : t("Катушка не назначена")}
        </div>
        <div className="muted direct-feed-sub">
          {spool
            ? [spool.color_name || spool.label, grams != null ? `${Math.round(grams)} ${t("г")}` : null]
                .filter(Boolean).join(" · ")
            : `${slot?.name || `${t("Слот")} ${slot?.slot_index ?? 1}`} — ${t("привязать в разделе «Принтеры»")}`}
        </div>
      </div>
      <Icon name="spool" size={18} />
    </div>
  );
}

// Блок «Ресурс принтера» — статистика за всё время. Вынесен из карточки принтера,
// чтобы показываться отдельным блоком в общем потоке дашборда.
function PrinterLifetime({ totals, name }) {
  if (!totals) return null;
  return (
    <div className="printer-lifetime">
      <div className="printer-lifetime-head">
        <div>
          <div className="printer-lifetime-title">{t("Ресурс принтера")}</div>
          <div className="printer-lifetime-subtitle">{name || t("Статистика за всё время")}</div>
        </div>
      </div>
      <div className="printer-lifetime-body">
        <div className="printer-lifetime-hero">
          <span>{t("Всего печатей")}</span>
          <b>{totals.total_jobs}</b>
          <em>{t("завершённых заданий")}</em>
        </div>
        <div className="printer-lifetime-grid">
          <div className="printer-lifetime-stat">
            <span>{t("Время печати")}</span>
            <b>{Math.round((totals.total_print_time_sec || 0) / 3600)}</b>
            <em>{t("ч печати")}</em>
          </div>
          <div className="printer-lifetime-stat">
            <span>{t("Филамент")}</span>
            <b>{((totals.total_filament_mm || 0) / 1e6).toFixed(2)}</b>
            <em>{t("км филамента")}</em>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

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
    <div>
      <h2 style={{ marginBottom: 2 }}>{t("Панель")}</h2>
      <div className="muted" style={{ marginBottom: 16 }}>{t("Обзор запасов филамента и недавней активности.")}</div>

      <div className="dash-kpis">
        <Kpi label={t("Всего катушек")} value={d.total_spools} sub={`+${d.added_this_month} ${t("в этом месяце")}`} />
        <Kpi label={t("Заканчиваются")} value={d.low_stock_count} sub={t("Требуют внимания")} />
        <Kpi label={t("Остаток филамента")} value={`${(d.est_filament_left_g / 1000).toFixed(1)} ${t("кг")}`} sub={`~${d.est_print_hours} ${t("ч печати")}`} />
        <Kpi
          label={t("Печатей (30 дн)")}
          value={d.recent_prints_30d}
          sub={`${(d.consumed_30d_g / 1000).toFixed(1)} ${t("кг израсходовано")}${d.consumed_30d_cost != null ? ` · ${fmtMoney(d.consumed_30d_cost, d.cost_currency)}` : ""}${d.failed_30d ? ` · ${t("брак")} ${d.failed_30d}` : ""}`}
          bg="var(--kpi4-bg)"
        />
      </div>

      {mrPrinters.length > 0 && (
        <div className="dash-printers">
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
        <div className="card env-conditions">
          <div className="env-conditions-head">
            <h3 className="card-title">{t("Условия хранения")}</h3>
            <span className="env-conditions-note">{t("по датчикам Home Assistant")}</span>
          </div>
          <div className="env-conditions-list">
            {looseSensors.map((s) => (
              <EnvSensor key={s.id} sensor={s} threshold={humidityMax} row />
            ))}
          </div>
        </div>
      )}

      {/* Четыре плитки в ряд. Раньше band был двумя строками половинной ширины,
          и графики растягивались до ~640px, раздуваясь по высоте. Подписи-
          пояснения убраны: оси и легенда говорят то же короче. */}
      <div className="dash-main">
        <div className="card">
          <h3 className="card-title">{t("Расход по месяцам")}</h3>
          <BarChart data={d.monthly_usage} materials={barMaterials} colorFor={colorFor} />
        </div>

        <div className="card">
          <h3 className="card-title">{t("Распределение по материалам")}</h3>
          {d.material_distribution.length ? <Donut data={d.material_distribution} colorFor={colorFor} /> : <div className="muted">{t("Нет данных")}</div>}
        </div>

        {/* Низкий остаток + быстрое добавление. На мобиле поднимается над графиками. */}
        <div className="card dash-quick">
          <h3 className="card-title">{t("Быстрые действия и уведомления")}</h3>
          {/* Тело растёт и прижимает кнопку к низу — плитка одной высоты с
              графиками и без пустого низа. */}
          <div className="dash-quick-body">
            {d.low_stock.length === 0 ? (
              <div className="ok-panel" style={{ marginTop: 12 }}>
                <div className="ok-panel-title"><Icon name="check" size={15} /> {t("Всё в порядке")}</div>
                <div className="muted">{t("Нет катушек с низким остатком.")}</div>
                <Link to="/spools" style={{ display: "inline-block", marginTop: 6 }}>{t("Все катушки →")}</Link>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {d.low_stock.slice(0, 3).map((s) => (
                  <div key={s.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{s.sub}</div>
                      </div>
                      <span className="badge empty">{s.remaining_g}{" "}{t("г")}</span>
                    </div>
                    <div className="lowstock-bar"><div style={{ width: `${Math.round(s.pct * 100)}%` }} /></div>
                  </div>
                ))}
                {d.low_stock.length > 3 && <Link to="/spools">{t("Весь инвентарь →")}</Link>}
              </div>
            )}
          </div>
          <button className="secondary" style={{ width: "100%", marginTop: 12 }} onClick={() => navigate("/spools/new")}>
            {t("＋ Добавить катушку")}
          </button>
        </div>

        {d.drying_alerts?.length > 0 && (
          <div className="card">
            <h3 className="card-title"><Icon name="droplet" size={15} /> {t("Пора просушить")}</h3>
            {d.drying_alerts.slice(0, 3).map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <Link to={`/spools/${a.id}`} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{a.material}</div>
                </div>
                <span className="badge almost_empty">{a.days} {t("дн")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {mrPrinters.map((p) => lifetimes[p.id] && (
        <PrinterLifetime
          key={p.id}
          totals={lifetimes[p.id]}
          name={mrPrinters.length > 1 ? p.name : undefined}
        />
      ))}

      <div className="card">
        <h3 className="card-title">{t("Недавняя активность")}</h3>
        <div className="act-list">
          {d.recent_activity.slice(0, 3).map((a, i) => {
            const neg = a.amount && a.amount.startsWith("-");
            const pos = a.amount && a.amount.startsWith("+");
            return (
              <div className="act-item" key={i}>
                <div style={{ minWidth: 0 }}>
                  <span className="act-name">{a.name}</span>{" "}
                  <span className={`act-tag ${a.type}`} style={{ marginLeft: 6 }}>{{ used: t("Расход"), added: t("Добавлено"), updated: t("Изменено"), moved: t("Перемещено") }[a.type] || a.type}</span>
                  <div className="act-sub">{tReason(a.sub)}</div>
                </div>
                <div className="act-right">
                  <div className={`act-amount ${neg ? "neg" : pos ? "pos" : ""}`}>{a.amount || "—"}</div>
                  <div className="act-time">{timeAgo(a.created_at)}</div>
                </div>
              </div>
            );
          })}
          {d.recent_activity.length === 0 && <div className="muted">{t("Пока нет активности")}</div>}
        </div>
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <Link to="/print-jobs">{t("Вся история →")}</Link>
        </div>
      </div>
    </div>
  );
}
