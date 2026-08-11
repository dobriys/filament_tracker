import { useEffect, useRef, useState } from "react";
import { t } from "../i18n.js";
import Icon from "./Icon.jsx";

// Знак вопроса рядом с подписью поля: объясняет, что вообще значит эта цифра.
//
// Открывается по клику, а не по наведению: на телефоне наведения нет, а поля
// вроде «Запас, ×» непонятны как раз всем и сразу. Нативный title тоже не
// подошёл — он не появляется на тач-экране и ждёт секунду на десктопе.
//
// Кнопка живёт внутри <label>, поэтому клик приходится глушить: иначе он
// провалился бы в поле ввода и открытие подсказки заодно ставило бы курсор.
// Отступ от края экрана, за который панель не заходит.
const EDGE = 12;

export default function Hint({ text }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const pop = useRef(null);
  // Насколько подвинуть панель влево, чтобы она не вылезла за край экрана.
  //
  // Прижать её к правому краю кнопки не годится: на узком экране панель шире
  // расстояния от кнопки до левого края, и прижатие выталкивает её уже влево.
  // Поэтому двигаем ровно на величину выхода за правый край и не дальше, чем
  // до отступа слева.
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!open) return;
    const box = pop.current?.getBoundingClientRect();
    if (box) {
      const over = box.right - (window.innerWidth - EDGE);
      setShift(over > 0 ? -Math.min(over, Math.max(0, box.left - EDGE)) : 0);
    }
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span className="hint" ref={wrap}>
      <button
        type="button"
        className={`hint-btn${open ? " active" : ""}`}
        aria-label={t("Что это значит")}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        <Icon name="help" size={14} strokeWidth={2} />
      </button>
      {open && (
        <span className="hint-pop" ref={pop} role="tooltip" style={{ marginLeft: shift }}>
          {text}
        </span>
      )}
    </span>
  );
}
