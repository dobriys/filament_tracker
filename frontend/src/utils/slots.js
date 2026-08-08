import { t } from "../i18n.js";

// Слот с индексом 0 — внешняя катушка (держатель сбоку от принтера), а не гейт
// хаба: гейты нумеруются с 1 (gate N ↔ slot_index N+1). См.
// backend/app/services/slot_service.py.
export const HOLDER_INDEX = 0;

export const isHolder = (slot) => slot?.slot_index === HOLDER_INDEX;

// Подпись слота. Имя приходит с бэка, но у старых записей его может не быть —
// тогда собираем сами, не превращая держатель в «Slot 0».
//
// detached — принтер сейчас в прямой подаче, то есть хаб снят. Катушки из его
// гейтов никуда не делись (привязку мы намеренно сохраняем), но в принтере их
// физически нет — на складе это надо говорить прямо, иначе «Kobra / Slot 2»
// читается как «стоит в принтере и вот-вот поедет в печать».
export function slotLabel(slot, { detached = false } = {}) {
  if (!slot) return "";
  const base = slot.name || (isHolder(slot) ? t("Внешняя катушка") : `Slot ${slot.slot_index}`);
  return detached && !isHolder(slot) ? `${base} (${t("хаб снят")})` : base;
}
