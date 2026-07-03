const CURRENCY_SIGN = { RUB: "₽", USD: "$", EUR: "€", CNY: "¥", GBP: "£" };

// Денежный вывод: "12.4 ₽" / "0.85 $"; null если цена неизвестна.
export function fmtMoney(value, currency) {
  if (value == null) return null;
  const sign = CURRENCY_SIGN[currency] || currency || "";
  const n = Number(value);
  const s = n >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "");
  return `${s} ${sign}`.trim();
}
