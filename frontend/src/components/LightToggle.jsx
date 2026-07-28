import { useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import Icon from "./Icon.jsx";

// Подсветка камеры принтера: два явных действия «вкл» и «выкл».
//
// Переключателем это было бы честнее на вид, но врало бы по сути: Moonraker
// отдаёт по такой лампе не показание, а последнюю отданную ей команду (у
// Anycubic на Rinkhals это power-устройство типа shell). Принтер гасит подсветку
// сам — по таймауту и после печати, — и Moonraker об этом не узнаёт: состояние
// остаётся «on», пока кто-нибудь не пошлёт команду. Одна кнопка-переключатель в
// такой ситуации отправила бы «выкл» уже погасшей лампе, и нажатие выглядело бы
// сломанным. Две кнопки всегда делают ровно то, что написано, а подсветка
// активной — это «последняя команда», о чём и говорит подсказка.
export default function LightToggle({ printerId, light, onChanged, onError }) {
  const [sent, setSent] = useState(null); // что отправили, пока ждём ответ
  const [busy, setBusy] = useState(false);
  if (!light) return null;

  const on = sent ?? light.on;

  async function send(next) {
    setSent(next); setBusy(true);
    onError?.(null);
    try {
      await api.post(`/api/printers/${printerId}/light`, { on: next });
      await onChanged?.();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
      setSent(null);
    }
  }

  return (
    <div
      className={`light-switch${on ? " on" : ""}`}
      title={t("Принтер не сообщает реальное состояние лампы — отмечена последняя отправленная команда")}
    >
      <Icon name="bulb" size={15} />
      <span className="light-switch-label">{t("Подсветка")}</span>
      <button type="button" className={on ? "active" : ""} disabled={busy} onClick={() => send(true)}>
        {t("вкл")}
      </button>
      <button type="button" className={on ? "" : "active"} disabled={busy} onClick={() => send(false)}>
        {t("выкл")}
      </button>
    </div>
  );
}
