import { useState } from "react";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import Icon from "./Icon.jsx";

// Переключатель подсветки камеры принтера.
//
// Состояние приходит из overview (light: {device, on, locked}); клик шлёт
// POST /api/printers/{id}/light. Пока принтер отвечает, кнопка показывает уже
// новое состояние — щелчок лампой должен ощущаться мгновенным, а расхождение
// исправит ответ сервера.
export default function LightToggle({ printerId, light, onChanged, onError, compact = false }) {
  const [pending, setPending] = useState(null); // ожидаемое состояние, пока идёт запрос
  const [busy, setBusy] = useState(false);
  if (!light) return null;

  const on = pending ?? light.on;

  async function toggle() {
    const next = !on;
    setPending(next); setBusy(true);
    onError?.(null);
    try {
      await api.post(`/api/printers/${printerId}/light`, { on: next });
      await onChanged?.();
    } catch (e) {
      // Не получилось (нет связи, принтер блокирует переключение в печати) —
      // возвращаем то, что знает принтер, и говорим почему.
      onError?.(e.message);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <button
      type="button"
      className={`light-toggle${on ? " on" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? t("Выключить подсветку") : t("Включить подсветку")}
    >
      <Icon name="bulb" size={15} />
      {!compact && <span>{t("Подсветка")}</span>}
      <span className="light-toggle-state">{on ? t("вкл") : t("выкл")}</span>
    </button>
  );
}
