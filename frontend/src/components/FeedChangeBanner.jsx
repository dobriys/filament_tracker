import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import Icon from "./Icon.jsx";
import SpoolPicker from "./SpoolPicker.jsx";
import { slotLabel } from "../utils/slots.js";

// «Подача изменилась — подтвердите катушки».
//
// Появляется, когда приложение заметило, что ACE сняли или поставили обратно
// (см. app/services/feed_mode.py). Смысл не в самом уведомлении: после
// перестановки железа приложение больше не знает, какие катушки где стоят, а
// автосписание должно точно знать, с какой катушки списывать. Поэтому до
// подтверждения списание стоит на паузе, и баннер — единственный способ его снять.
//
// Справочники тянем сами: баннер показывается редко, зато его можно вставить
// в любую страницу, ничего туда не прокидывая.
export default function FeedChangeBanner({ printer, change, onConfirmed }) {
  const [spools, setSpools] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [occupied, setOccupied] = useState({});
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const direct = change?.mode === "direct";
  const mmuName = change?.mmu_name || t("Мультиподача");
  const slots = change?.slots || [];

  // Панель перечитывает overview каждые несколько секунд, и объект change
  // каждый раз новый — сбрасывать по нему выбор нельзя, иначе он будет стираться
  // прямо под руками. Пересобираем только когда сменилось само событие или
  // состав слотов.
  const signature = `${change?.changed_at || ""}|${slots.map((s) => `${s.id}:${s.spool?.id || ""}`).join(",")}`;
  useEffect(() => {
    setPicks(Object.fromEntries(slots.map((s) => [s.id, s.spool?.id || null])));
  }, [signature]);

  useEffect(() => {
    api.get("/api/spools").then(setSpools).catch(() => {});
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
    api.get("/api/locations").then(setLocations).catch(() => {});
    // Занятость по всем принтерам — чтобы в списке было видно, что катушка уже
    // стоит в другом слоте (в том числе в слотах снятой ACE).
    (async () => {
      const printers = await api.get("/api/printers").catch(() => []);
      const map = {};
      for (const p of printers) {
        const ss = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        for (const s of ss) {
          if (!s.current_spool_id) continue;
          const name = slotLabel(s);
          map[s.current_spool_id] = p.id === printer.id ? name : `${p.name} / ${name}`;
        }
      }
      setOccupied(map);
    })();
  }, [printer.id]);

  async function confirm() {
    setBusy(true);
    setErr("");
    try {
      await api.post(`/api/printers/${printer.id}/feed-confirm`, {
        slots: slots.map((s) => ({ slot_id: s.id, spool_id: picks[s.id] || null })),
      });
      onConfirmed?.();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!change) return null;

  return (
    <div className="feed-change">
      <div className="feed-change-head">
        <Icon name="alert" size={16} />
        <div>
          <b>
            {direct
              ? `${mmuName} ${t("отключена")} — ${t("печать идёт с отдельной катушки")}`
              : `${mmuName} ${t("снова подключена")}`}
          </b>
          <div className="muted feed-change-sub">
            {direct
              ? t("Подтвердите, какая катушка стоит снаружи на держателе. Слоты хаба скрыты, привязки сохранены.")
              : t("Подтвердите, какие катушки стоят в слотах.")}{" "}
            {t("Автосписание на паузе до подтверждения.")}
          </div>
        </div>
      </div>

      <div className="feed-change-slots">
        {slots.map((s) => (
          <div key={s.id} className="feed-change-slot">
            <span className="muted">{slotLabel(s)}</span>
            <SpoolPicker
              spools={spools}
              profiles={profiles}
              locations={locations}
              occupied={occupied}
              value={picks[s.id] || null}
              disabled={busy}
              placeholder={t("— слот пуст —")}
              onSelect={(id) => setPicks((p) => ({ ...p, [s.id]: id }))}
            />
            {picks[s.id] && (
              <button
                className="secondary feed-change-clear"
                disabled={busy}
                title={t("Слот пуст")}
                onClick={() => setPicks((p) => ({ ...p, [s.id]: null }))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {slots.length === 0 && (
          <div className="muted">{t("У принтера нет слотов — подтвердите смену режима.")}</div>
        )}
      </div>

      {err && <div className="error">{err}</div>}
      <div className="feed-change-actions">
        <button onClick={confirm} disabled={busy}>{t("Подтвердить")}</button>
      </div>
    </div>
  );
}
