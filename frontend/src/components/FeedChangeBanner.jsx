import { useEffect, useState } from "react";
import { AlertTriangle, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import SpoolPicker from "./SpoolPicker.jsx";
import { Notice } from "./ft/printer.jsx";
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
    <div className="mb-3 rounded-xl bg-warning-primary p-4 ring-1 ring-utility-yellow-200 ring-inset">
      <div className="flex items-start gap-3 text-warning-primary">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold">
            {direct
              ? `${mmuName} ${t("отключена")} — ${t("печать идёт с отдельной катушки")}`
              : `${mmuName} ${t("снова подключена")}`}
          </p>
          <p className="m-0 mt-1 text-sm text-secondary">
            {direct
              ? t("Подтвердите, какая катушка стоит снаружи на держателе. Слоты хаба скрыты, привязки сохранены.")
              : t("Подтвердите, какие катушки стоят в слотах.")}{" "}
            {t("Автосписание на паузе до подтверждения.")}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {slots.map((s) => (
          <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(90px,130px)_minmax(0,1fr)_auto]">
            <span className="col-span-2 text-sm text-secondary sm:col-span-1">{slotLabel(s)}</span>
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
            {picks[s.id] ? (
              <ButtonUtility
                size="sm"
                color="secondary"
                icon={XClose}
                isDisabled={busy}
                tooltip={t("Слот пуст")}
                onClick={() => setPicks((p) => ({ ...p, [s.id]: null }))}
              />
            ) : <span className="size-8" aria-hidden="true" />}
          </div>
        ))}
        {slots.length === 0 && (
          <p className="m-0 text-sm text-secondary">{t("У принтера нет слотов — подтвердите смену режима.")}</p>
        )}
      </div>

      {err && <Notice tone="error" className="mt-4">{err}</Notice>}
      <div className="mt-4">
        <Button size="md" isLoading={busy} onClick={confirm}>{t("Подтвердить")}</Button>
      </div>
    </div>
  );
}
