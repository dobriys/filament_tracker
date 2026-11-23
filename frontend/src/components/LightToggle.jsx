import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Lightbulb02 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { t } from "../i18n.js";

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

  const seg = (active) =>
    cx(
      "cursor-pointer rounded-md px-2.5 py-1 text-sm font-semibold outline-focus-ring transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
      active ? "bg-primary text-primary shadow-xs" : "bg-transparent text-tertiary hover:text-secondary",
    );

  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg bg-primary py-1 pr-1 pl-3 shadow-xs ring-1 ring-primary ring-inset"
      title={t("Принтер не сообщает реальное состояние лампы — отмечена последняя отправленная команда")}
    >
      <Lightbulb02 className={cx("size-4", on ? "text-fg-warning-primary" : "text-fg-quaternary")} aria-hidden="true" />
      <span className="text-sm font-medium text-secondary">{t("Подсветка")}</span>
      <div className="inline-flex rounded-md bg-secondary p-0.5">
        <AriaButton className={seg(on)} isDisabled={busy} onPress={() => send(true)}>{t("вкл")}</AriaButton>
        <AriaButton className={seg(!on)} isDisabled={busy} onPress={() => send(false)}>{t("выкл")}</AriaButton>
      </div>
    </div>
  );
}
