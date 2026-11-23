import { useEffect, useState } from "react";
import { XClose } from "@untitledui/icons";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { t } from "../i18n.js";
import SpoolPicker from "./SpoolPicker.jsx";
import { slotLabel } from "../utils/slots.js";

// Вердикты сверки «что видит принтер» ↔ «что привязано в приложении»
const VERDICT = {
  match: { icon: "✓", cls: "ok", tone: "success", label: () => t("Совпадает") },
  color_diff: { icon: "≈", cls: "hint", tone: "gray", label: () => t("Материал совпадает, оттенок отличается") },
  mismatch: { icon: "!", cls: "warn", tone: "warning", label: () => t("Не совпадает с катушкой") },
  unassigned: { icon: "+", cls: "hint", tone: "gray", label: () => t("Катушка не привязана") },
  empty: { icon: "—", cls: "dim", tone: "gray", label: () => t("Слот пуст") },
};

// Цвет значка вердикта в плитке слота.
const VERDICT_TEXT = {
  ok: "text-fg-success-primary",
  warn: "text-fg-warning-primary",
  hint: "text-fg-quaternary",
  dim: "text-fg-quaternary",
};

// Подпись вердикта. «Слот пуст, а катушка числится» общая фраза «не совпадает»
// объясняет плохо — тут надо прямо сказать, что катушку забыли снять.
function verdictNote(g) {
  if (g.verdict === "mismatch" && !g.occupied) {
    return t("Слот пуст, а катушка всё ещё привязана");
  }
  return (VERDICT[g.verdict] || VERDICT.empty).label();
}

const Dot = ({ hex, size = 14 }) => (
  <span
    aria-hidden="true"
    className="inline-block shrink-0 rounded-full align-middle ring-1 ring-black/10 ring-inset dark:ring-white/25"
    style={{ width: size, height: size, background: hex || "var(--color-bg-quaternary)" }}
  />
);

// Полная карточка гейта — для панели Moonraker на /printers
export function GateCard({ g }) {
  const v = VERDICT[g.verdict] || VERDICT.empty;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset" title={v.label()}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-tertiary">{t("Слот")} {g.slot_index}</span>
        <BadgeWithDot type="pill-color" size="sm" color={v.tone}>
          {g.verdict === "match" ? v.label() : g.verdict === "unassigned" ? t("Не привязана") : g.verdict === "empty" ? t("Пуст") : g.verdict === "mismatch" ? t("Не совпадает") : t("Оттенок")}
        </BadgeWithDot>
      </div>
      <div className="flex items-center gap-3">
        <Dot hex={g.occupied ? g.color_hex : null} size={32} />
        <div className="min-w-0">
          <p className="text-md font-semibold text-primary">{g.occupied ? (g.material || "—") : t("пусто")}</p>
          <p className="flex items-center gap-1.5 truncate text-sm text-tertiary">
            {g.spool ? (
              <>
                <Dot hex={g.spool.color_hex} size={10} />
                <span className="truncate">{g.spool.color_name || g.spool.label || t("Без метки")}</span>
              </>
            ) : (
              <span className="truncate">{v.label()}</span>
            )}
          </p>
        </div>
      </div>
      {g.spool?.current_weight_g != null && (
        <p className="text-sm font-medium text-secondary tabular-nums">{Math.round(g.spool.current_weight_g)} {t("г")}</p>
      )}
    </div>
  );
}

// Плитки гейтов — для карточки принтера на главной (стиль макета).
// С onSelect плитка кликабельна: по ней открывается GateEditor.
export function GateChips({ gates, selected = null, onSelect }) {
  if (!gates?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
      {gates.map((g) => {
        const v = VERDICT[g.verdict] || VERDICT.empty;
        const isSel = selected === g.gate;
        const hint = `${t("Слот")} ${g.slot_index}: ${g.occupied ? g.material || "" : t("пусто")} · ${verdictNote(g)}`;
        const pick = onSelect
          ? {
              role: "button",
              tabIndex: 0,
              "aria-pressed": isSel,
              onClick: () => onSelect(g.gate),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(g.gate); }
              },
            }
          : {};
        return (
          <div
            key={g.gate}
            className={cx(
              "relative flex flex-col items-center gap-2 rounded-xl bg-primary px-2 pt-4 pb-3 text-center ring-inset outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
              isSel ? "ring-2 ring-brand-500" : "ring-1 ring-secondary",
              g.verdict === "mismatch" && !isSel && "ring-utility-yellow-300",
              onSelect && "cursor-pointer transition duration-100 ease-linear hover:bg-primary_hover",
            )}
            title={onSelect ? `${hint} · ${t("нажмите, чтобы привязать или снять катушку")}` : hint}
            {...pick}
          >
            <span className={cx("absolute top-1.5 right-2 text-sm leading-none font-bold", VERDICT_TEXT[v.cls])} aria-hidden="true">{v.icon}</span>
            <Dot hex={g.occupied ? g.color_hex : null} size={40} />
            <p className="text-xs font-semibold text-primary">{g.slot_index}: {g.occupied ? (g.material || "—") : t("пусто")}</p>
            {g.spool?.current_weight_g != null && (
              <p className="-mt-1 text-xs text-tertiary tabular-nums">{Math.round(g.spool.current_weight_g)} {t("г")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Привязка и снятие катушки прямо под плитками слотов — чтобы не ходить в
// «Мои катушки» и в карточку самой катушки. Справочники (катушки, профили,
// места, занятость слотов) тянем сами и только при открытии: на главной это
// нужно раз в несколько дней, а плитки живут на каждой загрузке.
export function GateEditor({ printer, gate: g, onChanged, onClose }) {
  const [spools, setSpools] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [occupied, setOccupied] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    api.get("/api/spools")
      .then((r) => alive && setSpools(r))
      .catch((e) => { if (alive) { setSpools([]); setErr(String(e.message || e)); } });
    api.get("/api/filament-profiles").then((r) => alive && setProfiles(r)).catch(() => {});
    api.get("/api/locations").then((r) => alive && setLocations(r)).catch(() => {});
    // Занятость по всем принтерам: в списке видно, что катушка уже стоит в
    // другом слоте (привязка её оттуда заберёт).
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
      if (alive) setOccupied(map);
    })();
    return () => { alive = false; };
  }, [printer.id]);

  // Ошибка относится к слоту, на котором случилась, — на соседнем не тянем её.
  useEffect(() => { setErr(""); }, [g.gate]);

  async function run(action) {
    setBusy(true);
    setErr("");
    try {
      await action();
      await onChanged?.();
      // Итог виден по самой плитке (значок вердикта), так что закрываем
      // редактор — иначе каждое действие требовало бы ещё и клика «закрыть».
      onClose?.();
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  }

  // Записи слота может не быть (хаб больше, чем заведено слотов): ищем её по
  // номеру заново, а не берём из устаревшей сводки, и только потом создаём.
  async function slotIdFor() {
    if (g.slot_id) return g.slot_id;
    const list = await api.get(`/api/printers/${printer.id}/slots`);
    const found = list.find((s) => s.slot_index === g.slot_index);
    if (found) return found.id;
    const created = await api.post(`/api/printers/${printer.id}/slots`, { slot_index: g.slot_index });
    return created.id;
  }

  const bind = (spoolId) =>
    spoolId && run(async () => {
      const slotId = await slotIdFor();
      await api.post(`/api/slots/${slotId}/assign-spool`, { spool_id: spoolId });
    });
  const unbind = () =>
    run(() => api.post(`/api/slots/${g.slot_id}/unassign-spool`));

  const v = VERDICT[g.verdict] || VERDICT.empty;
  const bound = g.spool;
  const grams = bound?.current_weight_g;
  // Забыли снять катушку из пустого слота — это единственное, что тут надо сделать.
  const forgotten = g.verdict === "mismatch" && !g.occupied;

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-xl bg-secondary p-4 ring-1 ring-secondary ring-inset">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-md font-semibold text-primary">{t("Слот")} {g.slot_index}</p>
        <BadgeWithDot type="pill-color" size="sm" color={v.tone}>{verdictNote(g)}</BadgeWithDot>
        <div className="ml-auto">
          <ButtonUtility size="xs" color="tertiary" icon={XClose} tooltip={t("Закрыть")} onClick={onClose} />
        </div>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-2 text-sm">
        <dt className="text-tertiary">{t("Принтер видит")}</dt>
        <dd className="m-0 flex items-center gap-2 font-medium text-primary">
          <Dot hex={g.occupied ? g.color_hex : null} size={12} />
          {g.occupied ? (g.material || "—") : t("пусто")}
        </dd>

        <dt className="text-tertiary">{t("Привязана")}</dt>
        <dd className="m-0 flex flex-wrap items-center gap-2 font-medium text-primary">
          {bound ? (
            <>
              <Dot hex={bound.color_hex} size={12} />
              <span className="min-w-0 break-words">
                {[bound.color_name || bound.label || t("Без метки"), bound.material].filter(Boolean).join(" · ")}
                {grams != null ? ` · ${Math.round(grams)} ${t("г")}` : ""}
              </span>
              <Button size="sm" color={forgotten ? "primary" : "secondary"} isDisabled={busy} onClick={unbind}>{t("Снять")}</Button>
            </>
          ) : (
            <span className="font-normal text-tertiary">{t("нет")}</span>
          )}
        </dd>
      </dl>

      <SpoolPicker
        spools={spools || []}
        profiles={profiles}
        locations={locations}
        occupied={occupied}
        preferMaterial={g.occupied ? g.material : ""}
        disabled={busy || spools === null}
        placeholder={bound ? t("— заменить катушку —") : t("— привязать катушку —")}
        onSelect={(id) => id !== bound?.id && bind(id)}
      />
      {err && <p className="text-sm text-error-primary">{err}</p>}
    </div>
  );
}
