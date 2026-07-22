// Показания датчика температуры и влажности (Home Assistant).
//
// Один и тот же вид нужен в трёх местах — на дашборде, под карточкой принтера и
// в списке мест хранения, — поэтому вынесен сюда. Порог влажности приходит из
// настроек: выше него плашка подсвечивается, потому что филамент в этот момент
// набирает влагу.
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { t, dateLocale } from "../i18n.js";
import Icon from "./Icon.jsx";

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

export default function EnvSensor({ sensor, threshold = 45, showName = true, inline = false }) {
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

  return (
    <div className={`env-sensor${inline ? " env-sensor--inline" : ""}${wet ? " wet" : ""}`}>
      {showName && <div className="env-sensor-name">{sensor.name}</div>}
      {error ? (
        <div className="env-sensor-error" title={error}>{t("Нет связи с Home Assistant")}</div>
      ) : (
        <>
          <div className="env-readout">
            {/* Влага — единственная реальная угроза филаменту, поэтому она главная. */}
            <div className={`env-humidity${wet ? " is-wet" : ""}`}>
              <div className="env-humidity-head">
                <Icon name="droplet" size={15} />
                <b className="mono env-humidity-val">
                  {humidity != null ? humidity.toFixed(0) : "—"}<span className="env-unit">%</span>
                </b>
                {wet && <span className="env-flag">{t("выше")} {limit}%</span>}
              </div>
              <div
                className="env-gauge"
                title={humidity != null ? `${humidity.toFixed(1)}% · ${t("порог")} ${limit}%` : undefined}
              >
                <div className="env-gauge-fill" style={{ width: `${fill}%` }} />
                <div className="env-gauge-mark" style={{ left: `${mark}%` }} />
              </div>
            </div>
            {/* Температура — контекст, держим тихой. */}
            <div className="env-temp" title={t("Температура")}>
              <Icon name="thermometer" size={14} />
              <span className="mono">{temperature != null ? `${temperature.toFixed(1)}°C` : "—"}</span>
            </div>
          </div>
          {(battery != null || ago(sensor.updated_at)) && (
            <div className="env-sensor-foot">
              {battery != null && (
                lowBattery
                  ? <span className="badge empty" title={t("Пора менять батарейку")}><Icon name="battery" size={13} /> {Math.round(battery)}%</span>
                  : <span className="muted inline-ico"><Icon name="battery" size={13} /> {Math.round(battery)}%</span>
              )}
              {ago(sensor.updated_at) && <span className="muted">{ago(sensor.updated_at)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
