import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, tReason } from "../i18n.js";
import { GateChips } from "../components/HubGates.jsx";
import { PrinterArt, brandAccent } from "../components/PrinterArt.jsx";

const MAT_COLORS = ["#2e6be6", "#3d4657", "#17a34a", "#f6a723", "#8a5fbf", "#e0526e", "#17a2a6", "#9aa1ab"];

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60) || 1} ${t("мин назад")}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${t("ч назад")}`;
  return `${Math.floor(s / 86400)} ${t("дн назад")}`;
}

function BarChart({ data }) {
  const W = 420, H = 165, padL = 34, padB = 24, padT = 8;
  const max = Math.max(1, ...data.map((d) => d.grams));
  // «красивый» потолок чуть выше максимума — столбики читаются при любых данных
  const unit = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = [1, 1.5, 2, 3, 5, 10].map((k) => k * unit).find((v) => v >= max) || max;
  const cw = W - padL, ch = H - padB - padT;
  const bw = (cw / data.length) * 0.55;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {ticks.map((t, i) => {
        const y = padT + ch * (1 - t);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{Math.round(niceMax * t)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padL + (cw / data.length) * i + (cw / data.length - bw) / 2;
        const h = ch * (d.grams / niceMax);
        const y = padT + ch - h;
        const recent = i >= data.length - 2; // последние 2 месяца — акцент
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(0, h)} rx="4" fill={recent ? "var(--accent)" : "var(--border)"} />
            <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{t(d.label)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ data }) {
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
                stroke={MAT_COLORS[i % MAT_COLORS.length]} strokeWidth="20"
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
            <span style={{ width: 9, height: 9, borderRadius: 3, background: MAT_COLORS[i % MAT_COLORS.length] }} />
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

function DryerControls({ printer, dryer, onChanged }) {
  const [temp, setTemp] = useState(45);
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [remainingSec, setRemainingSec] = useState(null);
  const drying = dryer?.status === "drying";

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
    setBusy(true);
    try {
      await api.post(`/api/printers/${printer.id}/dryer`, {
        action,
        temp_c: Number(temp) || null,
        duration_min: Math.round((Number(hours) || 0) * 60) || null,
        unit: dryer?.unit ?? null,
      });
      await new Promise((r) => setTimeout(r, 2500));
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const remainingLabel = remainingSec != null ? fmtDryerRemaining(remainingSec) : null;
  const durationLabel = dryer?.duration_min > 0 ? fmtDryerRemaining(dryer.duration_min * 60) : null;

  return (
    <div className="dryer-control">
      <div className="dryer-head">
        <div>
          <div className="dryer-title">{t("Сушка филамента")}</div>
          <div className={`dryer-state ${drying ? "on" : ""} ${dryer?.status === "heater_err" ? "error" : ""}`}>
            <span />
            {drying ? t("Идёт сушка") : dryer?.status === "heater_err" ? t("ошибка нагревателя") : t("выключена")}
          </div>
        </div>
        <button
          type="button"
          className={`apple-switch ${drying ? "on" : ""}`}
          role="switch"
          aria-checked={drying}
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

function MoonrakerCard({ printer, navigate, onTotals }) {
  const [status, setStatus] = useState(null);
  const [gates, setGates] = useState([]);
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
    const slow = setInterval(() => {
      if (visible()) { loadOverview(); loadJob(); }
    }, 60000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [printer.id, dryer?.status]);

  const canConsume = job && job.status === "completed" && !job.consumed;
  async function consume() {
    setErr(null); setBusy(true);
    try {
      const res = await api.post(`/api/printers/${printer.id}/moonraker-jobs/${encodeURIComponent(job.job_id)}/import`);
      navigate(`/print-jobs/${res.print_job_id}/consume`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const st = status?.state;
  const [stLabel, stTag] = STATE_RU[st] || [st || "—", ""];
  const isPrinting = st === "printing";
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
  const remaining = isPrinting && status?.progress > 0.02 && elapsed != null
    ? elapsed * (1 / status.progress - 1)
    : null;

  // Секции карточки — по возможностям принтера (авто из overview + пресет).
  const hasMmu = caps.has_mmu ?? gates.length > 0;
  const mmuTitle = caps.mmu_name ? `${t("Слоты")} ${caps.mmu_name}` : t("Слоты мультиподачи");
  const accent = brandAccent(printer.brand);

  return (
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
                  ⚠ {knownErr ? knownErr.label() : fmtPrinterError(errMsg)}
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
              <div className="zone-title">{isPrinting ? t("Печатается") : t("Последняя печать")}</div>
              <div className="zone-file-box" title={file}>{file || t("нет данных")}</div>
              {isPrinting ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "10px 0 6px" }}>
                    <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{pct != null ? pct + "%" : "—"}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{t("осталось ~")}{remaining != null ? fmtDur(remaining) : t("считаем…")}</span>
                  </div>
                  <div className="progress"><div style={{ width: `${pct || 0}%`, background: "var(--accent)" }} /></div>
                  <div className="zone-metrics">
                    <div><span className="muted">{t("Прошло")}</span><b className="mono">{fmtDur(elapsed)}</b></div>
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
                    : canConsume ? t("Списать материал по этой печати")
                    : t("Доступно после завершения печати")
                  }
                >
                  {job?.consumed ? t("Списано ✓") : t("Списать")}
                </button>
                <button className="secondary" onClick={() => navigate(`/printers?moonraker=${printer.id}`)}>{t("Завершённые задания →")}</button>
              </div>
            </div>

            {/* Блок «Слоты и сушка» — только если у принтера они есть */}
            {(hasMmu || dryer) && (
              <div className="printer-zone">
                {hasMmu && (
                  <>
                    <div className="zone-title">{mmuTitle}</div>
                    <GateChips gates={gates} />
                  </>
                )}
                {dryer && (
                  <div className="dryer-box">
                    <DryerControls printer={printer} dryer={dryer} onChanged={loadOverview} />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
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

function Kpi({ label, value, sub, icon, bg }) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
        <div className="kpi-icon" style={{ background: bg }}>{icon}</div>
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

  useEffect(() => {
    api.get("/api/dashboard").then(setD).catch(() => {});
    api.get("/api/printers").then((ps) => setMrPrinters(ps.filter((p) => p.integration_type === "moonraker"))).catch(() => {});
  }, []);
  if (!d) return <div>{t("Загрузка…")}</div>;

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>{t("Панель")}</h2>
      <div className="muted" style={{ marginBottom: 16 }}>{t("Обзор запасов филамента и недавней активности.")}</div>

      <div className="dash-kpis">
        <Kpi label={t("Всего катушек")} value={d.total_spools} sub={`+${d.added_this_month} ${t("в этом месяце")}`} icon="📦" bg="var(--kpi1-bg)" />
        <Kpi label={t("Заканчиваются")} value={d.low_stock_count} sub={t("Требуют внимания")} icon="⚠️" bg="var(--kpi2-bg)" />
        <Kpi label={t("Остаток филамента")} value={`${(d.est_filament_left_g / 1000).toFixed(1)} ${t("кг")}`} sub={`~${d.est_print_hours} ${t("ч печати")}`} icon="💧" bg="var(--kpi3-bg)" />
        <Kpi
          label={t("Печатей (30 дн)")}
          value={d.recent_prints_30d}
          sub={`${(d.consumed_30d_g / 1000).toFixed(1)} ${t("кг израсходовано")}${d.consumed_30d_cost != null ? ` · ${fmtMoney(d.consumed_30d_cost, d.cost_currency)}` : ""}${d.failed_30d ? ` · ${t("брак")} ${d.failed_30d}` : ""}`}
          icon="🖨️"
          bg="var(--kpi4-bg)"
        />
      </div>

      {mrPrinters.length > 0 && (
        <div className="dash-printers">
          {mrPrinters.map((p) => <MoonrakerCard key={p.id} printer={p} navigate={navigate} onTotals={onTotals} />)}
        </div>
      )}

      <div className="dash-main">
        <div>
          <div className="dash-charts">
            <div className="card">
              <h3 className="card-title">{t("Расход по месяцам")}</h3>
              <div className="card-sub">{t("Израсходовано за последние 6 месяцев (граммы).")}</div>
              <BarChart data={d.monthly_usage} />
            </div>
            <div className="card">
              <h3 className="card-title">{t("Распределение по материалам")}</h3>
              <div className="card-sub">{t("Текущие запасы по типу материала.")}</div>
              {d.material_distribution.length ? <Donut data={d.material_distribution} /> : <div className="muted">{t("Нет данных")}</div>}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3 className="card-title">{t("Быстрые действия и уведомления")}</h3>
            <button
              style={{ width: "100%", padding: "13px", fontSize: 15, fontWeight: 600, marginTop: 12 }}
              onClick={() => navigate("/spools/new")}
            >
              {t("＋ Добавить катушку")}
            </button>
            {d.low_stock.length === 0 ? (
              <div className="ok-panel">
                <div className="ok-panel-title">✓ {t("Всё в порядке")}</div>
                <div className="muted">{t("Нет катушек с низким остатком.")}</div>
                <Link to="/spools" style={{ display: "inline-block", marginTop: 6 }}>{t("Все катушки →")}</Link>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                {d.low_stock.map((s) => (
                  <div key={s.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div>{s.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{s.sub}</div>
                      </div>
                      <span className="badge empty">{s.remaining_g}{" "}{t("г")}</span>
                    </div>
                    <div className="lowstock-bar"><div style={{ width: `${Math.round(s.pct * 100)}%` }} /></div>
                  </div>
                ))}
                <Link to="/spools">{t("Весь инвентарь →")}</Link>
              </div>
            )}
          </div>

          {d.drying_alerts?.length > 0 && (
            <div className="card">
              <h3 className="card-title">{t("💧 Пора просушить")}</h3>
              <div className="card-sub">{t("Гигроскопичный филамент давно не сушился.")}</div>
              {d.drying_alerts.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <Link to={`/spools/${a.id}`}>{a.name}</Link>
                    <div className="muted" style={{ fontSize: 12 }}>{a.material}</div>
                  </div>
                  <span className="badge almost_empty">{a.days} {t("дн")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
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
