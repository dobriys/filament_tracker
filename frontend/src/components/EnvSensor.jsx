// Показания датчика температуры и влажности (Home Assistant).
//
// Один и тот же вид нужен в трёх местах — на дашборде, под карточкой принтера и
// в списке мест хранения, — поэтому вынесен сюда. Порог влажности приходит из
// настроек: выше него плашка подсвечивается, потому что филамент в этот момент
// набирает влагу.
import { useEffect, useState } from "react";
import { BatteryFull, BatteryLow, Droplets02, Thermometer01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { t, dateLocale } from "../i18n.js";

// Загрузка показаний с автообновлением. Датчики меняются медленно, а вкладку
// держат открытой часами — опрашиваем нечасто и только пока вкладка видима.
export function useEnvSensors(intervalMs = 60000) {
  const [env, setEnv] = useState({ sensors: [], humidity_alert_max_pct: 45 });

  useEffect(() => {
    const load = () => api.get("/api/environment").then(setEnv).catch(() => {});
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return env;
}

function ago(iso) {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (!Number.isFinite(min)) return null;
  if (min < 1) return t("только что");
  if (min < 60) return `${min} ${t("мин назад")}`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${t("ч назад")}`;
  return new Date(iso).toLocaleDateString(dateLocale());
}

export default function EnvSensor({ sensor, threshold = 45, showName = true, inline = false, spread = false, row = false }) {
  if (!sensor) return null;
  const { temperature, humidity, battery, error } = sensor;
  // Порог приходит с сервера уже действующим (свой у датчика либо общий);
  // проп остаётся запасным значением на случай старого ответа без поля.
  const limit = sensor.humidity_max ?? threshold;
  const wet = humidity != null && humidity > limit;
  // Заряд показывается всегда, когда сущность указана: иначе заполненное поле в
  // настройках выглядит как ничего не сделавшее. Ниже 15 % — плашкой, потому что
  // датчик скоро замолчит, а показания будут выглядеть живыми.
  const lowBattery = battery != null && battery < 15;
  // Шкала влаги: заливка = текущая влажность, метка = безопасный порог (оба 0–100 %).
  const fill = humidity != null ? Math.max(0, Math.min(100, humidity)) : 0;
  const mark = Math.max(0, Math.min(100, limit));
  const updated = ago(sensor.updated_at);

  // Куски переиспользуются во всех раскладках — держим их здесь, чтобы разметка
  // не расходилась между вариантами. Влажность — единственная цветная величина
  // в блоке, потому что единственная, требующая решения.
  const humidityHead = (
    <div className="flex items-center gap-1.5">
      <Droplets02 className={cx("size-4 shrink-0", wet ? "text-fg-warning-primary" : "text-fg-brand-primary")} aria-hidden="true" />
      <b className={cx("text-xl leading-none font-semibold tracking-tight tabular-nums", wet ? "text-warning-primary" : "text-primary")}>
        {humidity != null ? humidity.toFixed(0) : "—"}
        <span className="ml-px text-sm font-semibold text-tertiary">%</span>
      </b>
      {wet && (
        <span className="pt-px text-xs font-semibold tracking-wide text-warning-primary uppercase">{t("выше")} {limit}%</span>
      )}
    </div>
  );
  const gauge = (className) => (
    <div
      className={cx("relative rounded-full bg-quaternary", className)}
      title={humidity != null ? `${humidity.toFixed(1)}% · ${t("порог")} ${limit}%` : undefined}
    >
      <div
        className={cx("absolute top-0 left-0 h-full min-w-[3px] rounded-full transition-[width] duration-500 ease-out", wet ? "bg-utility-yellow-500" : "bg-utility-brand-500")}
        style={{ width: `${fill}%` }}
      />
      {/* Метка безопасного порога — видно, насколько близко к «мокрому». */}
      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-px rounded-sm bg-fg-quaternary" style={{ left: `${mark}%` }} />
    </div>
  );
  // Температура — контекст, не тревога: ахроматична намеренно.
  const tempEl = (
    <div className="inline-flex items-center gap-1.5 text-md text-tertiary" title={t("Температура")}>
      <Thermometer01 className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
      <span className="font-semibold text-secondary tabular-nums">{temperature != null ? `${temperature.toFixed(1)}°C` : "—"}</span>
    </div>
  );
  const foot = (battery != null || updated) ? (
    <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
      {battery != null && (
        lowBattery ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-error-primary px-2 py-0.5 font-medium text-error-primary ring-1 ring-utility-red-200 ring-inset"
            title={t("Пора менять батарейку")}
          >
            <BatteryLow className="size-3.5" aria-hidden="true" /> {Math.round(battery)}%
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <BatteryFull className="size-3.5" aria-hidden="true" /> {Math.round(battery)}%
          </span>
        )
      )}
      {updated && <span>{updated}</span>}
    </div>
  ) : null;
  const errorEl = (
    <div className="text-sm text-tertiary" title={error}>{t("Нет связи с Home Assistant")}</div>
  );

  // Строчный вид — карточка «Условия хранения» на панели. Датчиков там мало,
  // поэтому каждый умещается в одну плотную линию: имя слева, показания справа.
  if (row) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        {showName && <div className="text-md font-semibold break-words text-primary">{sensor.name}</div>}
        {error ? errorEl : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {humidityHead}
            {humidity != null && gauge("h-1.5 w-14 flex-none")}
            {tempEl}
            {foot}
          </div>
        )}
      </div>
    );
  }

  // Растянутый вид (под слотами): числа разнесены по ширине блока, а шкала
  // влаги тянется во всю ширину — по ряду слотов, катушки которых она бережёт.
  if (spread) {
    return (
      <div className="min-w-0">
        {showName && <div className="mb-2 font-semibold break-words text-primary">{sensor.name}</div>}
        {error ? errorEl : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
              {humidityHead}
              {tempEl}
              {foot}
            </div>
            {humidity != null && gauge("mt-3.5 h-1.5")}
          </>
        )}
      </div>
    );
  }

  // Встроенный вид (ячейка в списке мест) — данные лежат как данные, без коробки.
  // Обычный вид — отдельная плашка; при высокой влажности подсвечивается.
  return (
    <div
      className={cx(
        "min-w-0",
        !inline && "rounded-xl p-3 ring-1 ring-inset",
        !inline && (wet ? "bg-warning-primary ring-utility-yellow-200" : "bg-secondary_alt ring-secondary"),
      )}
    >
      {showName && <div className="mb-2 font-semibold break-words text-primary">{sensor.name}</div>}
      {error ? errorEl : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Влага — единственная реальная угроза филаменту, поэтому она главная. */}
            <div className="min-w-24">
              {humidityHead}
              {humidity != null && gauge("mt-2 h-1.5")}
            </div>
            {tempEl}
          </div>
          {foot && <div className={inline ? "mt-1.5" : "mt-2"}>{foot}</div>}
        </>
      )}
    </div>
  );
}
