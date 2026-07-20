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

export default function EnvSensor({ sensor, threshold = 45, showName = true }) {
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

  return (
    <div className={`env-sensor${wet ? " wet" : ""}`}>
      {showName && <div className="env-sensor-name">{sensor.name}</div>}
      {error ? (
        <div className="env-sensor-error" title={error}>{t("Нет связи с Home Assistant")}</div>
      ) : (
        <>
          <div className="env-sensor-metrics">
            <div className="env-sensor-metric">
              <span className="muted">{t("Температура")}</span>
              <b className="mono">{temperature != null ? `${temperature.toFixed(1)}°C` : "—"}</b>
            </div>
            <div className="env-sensor-metric">
              <span className="muted">{t("Влажность")}</span>
              <b className="mono">{humidity != null ? `${humidity.toFixed(1)}%` : "—"}</b>
            </div>
          </div>
          <div className="env-sensor-foot">
            {wet && <span className="badge almost_empty">{t("выше порога")} {limit}%</span>}
            {battery != null && (
              lowBattery
                ? <span className="badge empty" title={t("Пора менять батарейку")}><Icon name="battery" size={13} /> {Math.round(battery)}%</span>
                : <span className="muted inline-ico"><Icon name="battery" size={13} /> {Math.round(battery)}%</span>
            )}
            {ago(sensor.updated_at) && <span className="muted">{ago(sensor.updated_at)}</span>}
          </div>
        </>
      )}
    </div>
  );
}
