import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { ChevronDown, SearchLg } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { t } from "../i18n.js";
import { enrichSpool } from "../utils/spools.js";

const RED = "var(--color-utility-red-500, #f04438)";

// Точка цвета — единственный признак, по которому катушка узнаётся мгновенно.
const Dot = ({ color }) => (
  <span
    aria-hidden="true"
    className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/25"
    style={{ background: color || "var(--color-bg-quaternary)" }}
  />
);

// Выбор катушки списком с цветом, материалом и остатком.
//
// Нативный <select> показывал только метку и вес — «PLA+ (715 г)» рядом с
// «PLA+ (841 г)» ничего не говорило о том, какая это катушка. Здесь строка
// несёт цвет, материал, место хранения и занятость слотом, а длинный список
// фильтруется поиском.
export default function SpoolPicker({
  spools = [],
  profiles = [],
  locations = [],
  occupied = {}, // spool_id -> «Принтер / Slot 2»
  preferMaterial = "", // материал, который принтер видит в слоте, — такие катушки выше
  value = null,
  disabled = false,
  placeholder = t("— выбрать катушку —"),
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Где рисовать список: {left, width, up, top, bottom}. Список «плавает» над
  // страницей (position: fixed), а не лежит внутри ячейки: таблицы и карточки
  // с overflow обрезали бы его по своей рамке.
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const input = useRef(null);
  const listRef = useRef(null);

  const items = useMemo(() => {
    // «PLA+», «PLA-CF» и «PLA» — один материал: сравниваем по первому слову.
    const base = (m) => (m || "").toUpperCase().split(/[^A-Z0-9]/)[0];
    const want = base(preferMaterial);
    return spools
      .filter((s) => s.status !== "archived")
      .map((s) => ({ s, e: enrichSpool(s, { profiles, locations }) }))
      // Свободные катушки выше занятых, подходящие слоту — выше прочих,
      // дальше по материалу и названию.
      .sort((a, b) => {
        const oa = occupied[a.s.id] ? 1 : 0;
        const ob = occupied[b.s.id] ? 1 : 0;
        if (oa !== ob) return oa - ob;
        if (want) {
          const ma = base(a.e.material) === want ? 0 : 1;
          const mb = base(b.e.material) === want ? 0 : 1;
          if (ma !== mb) return ma - mb;
        }
        return (a.e.material || "").localeCompare(b.e.material || "") ||
          a.e.title.localeCompare(b.e.title);
      });
  }, [spools, profiles, locations, occupied, preferMaterial]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(({ e }) =>
      `${e.title} ${e.sku} ${e.material} ${e.colorName} ${e.colorHex} ${e.locName}`.toLowerCase().includes(q));
  }, [items, query]);

  const current = value ? items.find(({ s }) => s.id === value) : null;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); }
  }, [open]);

  // Список рисуется кадром позже открытия (после расчёта места) — фокус на
  // поиск ставим, когда он уже есть.
  const ready = !!pos;
  useEffect(() => {
    if (open && ready) input.current?.focus();
  }, [open, ready]);

  // Слоты стоят внизу карточки, и список часто открывается у нижнего края
  // экрана — тогда разворачиваем его вверх. На узком экране список шире
  // ячейки, поэтому его ещё и подвигаем внутрь окна.
  const place = useCallback(() => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;
    const narrow = vw < 640;
    const width = narrow ? Math.min(vw * 0.92, 360) : Math.min(Math.max(370, r.width), 460, vw * 0.92);
    const left = Math.max(pad, Math.min(narrow ? r.right - width : r.left, vw - pad - width));
    const need = Math.min(380, vh * 0.45 + 60);
    setPos({ left, width, up: vh - r.bottom < need && r.top > need, top: r.bottom + 6, bottom: vh - r.top + 6 });
  }, []);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    place();
    // Список не едет за страницей сам — пересчитываем при прокрутке (в том числе
    // внутри вложенных областей) и при изменении размера окна.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Подсветка курсором не должна уезжать за край списка при прокрутке клавишами.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(id) {
    setOpen(false);
    onSelect?.(id);
  }

  function onInputKey(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = shown[active];
      if (pick) choose(pick.s.id);
    }
  }

  return (
    <div className="relative min-w-0" ref={wrap}>
      <AriaButton
        isDisabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={current ? `${t("Катушка")}: ${current.e.title}` : placeholder}
        onPress={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-primary px-3 py-2 text-left text-sm font-medium text-primary shadow-xs ring-1 ring-primary outline-focus-ring ring-inset hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-52"
      >
        {current ? (
          <>
            <Dot color={current.e.colorHex} />
            <span className="min-w-0 truncate">{current.e.title}</span>
            <span className="text-xs text-tertiary tabular-nums">{current.e.remaining.toFixed(0)} {t("г")}</span>
          </>
        ) : (
          <span className="text-tertiary">{placeholder}</span>
        )}
        <ChevronDown className={cx("ml-auto size-4 shrink-0 text-fg-quaternary transition duration-100 ease-linear", open && "rotate-180")} aria-hidden="true" />
      </AriaButton>

      {open && pos && (
        <div
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }) }}
          className="fixed z-50 overflow-hidden rounded-xl bg-primary shadow-lg ring-1 ring-secondary"
        >
          <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
            <SearchLg className="size-4 shrink-0 text-fg-quaternary" aria-hidden="true" />
            <input
              ref={input}
              value={query}
              placeholder={t("Поиск: название, материал, цвет…")}
              aria-label={t("Поиск: название, материал, цвет…")}
              className="m-0 w-full bg-transparent p-0 text-sm text-primary outline-hidden placeholder:text-placeholder"
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onInputKey}
            />
          </div>
          <div className="max-h-[min(320px,45vh)] overflow-y-auto p-1.5" ref={listRef} role="listbox">
            {shown.map(({ s, e }, i) => (
              <button
                type="button"
                key={s.id}
                role="option"
                aria-selected={s.id === value}
                data-active={i === active ? "" : undefined}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-focus-ring focus-visible:outline-2 focus-visible:-outline-offset-2",
                  s.id === value ? "bg-utility-brand-50" : i === active ? "bg-primary_hover" : "bg-transparent",
                )}
                title={[e.title, e.material, e.colorName, e.locName, occupied[s.id]].filter(Boolean).join(" · ")}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s.id)}
              >
                <Dot color={e.colorHex} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-primary">{e.title}</span>
                  <span className="mt-px block truncate text-xs text-tertiary">
                    {[e.material, e.colorName, e.locLeaf].filter(Boolean).join(" · ") || t("без описания")}
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right">
                  <span className={cx("block text-sm tabular-nums", e.low ? "text-error-primary" : "text-secondary")}>
                    {e.remaining.toFixed(0)} {t("г")}
                  </span>
                  {occupied[s.id] ? (
                    <span className="mt-0.5 block truncate text-xs text-tertiary">{occupied[s.id]}</span>
                  ) : (
                    <span className="mt-1 block h-1 overflow-hidden rounded-sm bg-quaternary">
                      <i
                        className="block h-full"
                        style={{ width: `${e.pct * 100}%`, background: e.low ? RED : e.colorHex || "var(--color-fg-quaternary)" }}
                      />
                    </span>
                  )}
                </span>
              </button>
            ))}
            {shown.length === 0 && <div className="px-2.5 py-3.5 text-center text-sm text-tertiary">{t("Ничего не найдено")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
