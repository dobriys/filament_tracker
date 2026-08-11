// Валюты, которые можно выбрать в интерфейсе. Набор совпадает с тем, что умеет
// подписывать бэкенд в уведомлениях (printer_watch._CURRENCY_SYMBOL).
export const CURRENCY_SIGN = {
  RUB: "₽", USD: "$", EUR: "€", GBP: "£", CNY: "¥", UAH: "₴", KZT: "₸", BYN: "Br",
};
export const CURRENCIES = Object.keys(CURRENCY_SIGN);

// Знак валюты для подписей полей («Цена принтера, ₽»). Незнакомый код
// показываем как есть — это честнее пустоты.
export function currencySign(currency) {
  return CURRENCY_SIGN[currency] || currency || "";
}

// Денежный вывод: "12.4 ₽" / "0.85 $"; null если цена неизвестна.
export function fmtMoney(value, currency) {
  if (value == null) return null;
  const sign = currencySign(currency);
  const n = Number(value);
  const s = n >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "");
  return `${s} ${sign}`.trim();
}
