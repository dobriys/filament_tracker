import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n.js";
import Icon from "./Icon.jsx";
import { enrichSpool } from "../utils/spools.js";

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
  value = null,
  disabled = false,
  placeholder = t("— выбрать катушку —"),
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false); // раскрыть вверх, если внизу не помещается
  const [shift, setShift] = useState(0); // сдвиг, чтобы список не вылезал за экран
  const wrap = useRef(null);
  const input = useRef(null);
  const listRef = useRef(null);
  const menuRef = useRef(null);

  const items = useMemo(() => {
    return spools
      .filter((s) => s.status !== "archived")
      .map((s) => ({ s, e: enrichSpool(s, { profiles, locations }) }))
      // Свободные катушки выше занятых, дальше по материалу и названию.
      .sort((a, b) => {
        const oa = occupied[a.s.id] ? 1 : 0;
        const ob = occupied[b.s.id] ? 1 : 0;
        if (oa !== ob) return oa - ob;
        return (a.e.material || "").localeCompare(b.e.material || "") ||
          a.e.title.localeCompare(b.e.title);
      });
  }, [spools, profiles, locations, occupied]);

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
    if (open) { setQuery(""); setActive(0); input.current?.focus(); }
  }, [open]);

  // Слоты стоят внизу карточки, и список часто открывается у нижнего края
  // экрана — тогда разворачиваем его вверх. На узком экране список шире
  // ячейки, поэтому его ещё и подвигаем внутрь окна.
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const r = wrap.current?.getBoundingClientRect();
    if (r) {
      const need = Math.min(380, window.innerHeight * 0.45 + 60);
      setUp(window.innerHeight - r.bottom < need && r.top > need);
    }
    const m = menuRef.current?.getBoundingClientRect();
    if (m) {
      const pad = 8;
      if (m.left < pad) setShift(pad - m.left);
      else if (m.right > window.innerWidth - pad) setShift(window.innerWidth - pad - m.right);
    }
  }, [open]);

  // Подсветка курсором не должна уезжать за край списка при прокрутке клавишами.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(".sp-opt.active")?.scrollIntoView({ block: "nearest" });
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
    <div className="spool-picker" ref={wrap}>
      <button
        type="button"
        className={`spool-picker-btn${current ? " has-value" : ""}`}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={current ? `${t("Катушка")}: ${current.e.title}` : placeholder}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <>
            <span className="sp-dot" style={{ background: current.e.colorHex || "var(--panel-3)" }} />
            <span className="sp-btn-title">{current.e.title}</span>
            <span className="muted mono sp-btn-g">{current.e.remaining.toFixed(0)}{" "}{t("г")}</span>
          </>
        ) : (
          <span className="muted">{placeholder}</span>
        )}
        <Icon name="chevron" size={14} />
      </button>

      {open && (
        <div
          className={`spool-picker-menu${up ? " up" : ""}`}
          ref={menuRef}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        >
          <div className="sp-search">
            <Icon name="search" size={14} />
            <input
              ref={input}
              value={query}
              placeholder={t("Поиск: название, материал, цвет…")}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onInputKey}
            />
          </div>
          <div className="sp-list" ref={listRef} role="listbox">
            {shown.map(({ s, e }, i) => (
              <button
                type="button"
                key={s.id}
                role="option"
                aria-selected={s.id === value}
                className={`sp-opt${i === active ? " active" : ""}${s.id === value ? " chosen" : ""}`}
                title={[e.title, e.material, e.colorName, e.locName, occupied[s.id]].filter(Boolean).join(" · ")}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s.id)}
              >
                <span className="sp-dot" style={{ background: e.colorHex || "var(--panel-3)" }} />
                <span className="sp-opt-main">
                  <span className="sp-opt-title">{e.title}</span>
                  <span className="sp-opt-sub">
                    {[e.material, e.colorName, e.locLeaf].filter(Boolean).join(" · ") || t("без описания")}
                  </span>
                </span>
                <span className="sp-opt-right">
                  <span className={`mono sp-opt-g${e.low ? " low" : ""}`}>{e.remaining.toFixed(0)}{" "}{t("г")}</span>
                  {occupied[s.id]
                    ? <span className="sp-opt-slot">{occupied[s.id]}</span>
                    : <span className="sp-bar"><i style={{ width: `${e.pct * 100}%`, background: e.low ? "var(--danger)" : e.colorHex || "var(--muted-2)" }} /></span>}
                </span>
              </button>
            ))}
            {shown.length === 0 && <div className="sp-empty muted">{t("Ничего не найдено")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
