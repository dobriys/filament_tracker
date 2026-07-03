// Лёгкий i18n в стиле gettext: русская строка — ключ, словарь только для en.
// Язык фиксируется на момент загрузки страницы; переключение (setLang)
// сохраняет выбор и перезагружает страницу — поэтому t() можно вызывать где
// угодно, включая константы на уровне модулей.
import { EN } from "./locales/en.js";

const KEY = "ft_lang";
const lang = localStorage.getItem(KEY) === "en" ? "en" : "ru";
document.documentElement.lang = lang;

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (next === lang) return;
  localStorage.setItem(KEY, next);
  window.location.reload();
}

// Перевод строки; для en без перевода возвращается русский оригинал.
export function t(s) {
  if (lang === "en") return EN[s] ?? s;
  return s;
}

// Локаль для дат/чисел (toLocaleString и т.п.)
export function dateLocale() {
  return lang === "en" ? "en-US" : "ru-RU";
}

// Перевод фиксированных фраз бэкенда, сохранённых в данных (журнал событий).
// «Печать <файл>» переводится по префиксу, остальные — целиком по словарю.
export function tReason(s) {
  if (!s) return s;
  if (s.startsWith("Печать ")) return `${t("Печать")} ${s.slice(7)}`;
  if (s.startsWith("Сушка ")) return `${t("Сушка")} ${s.slice(6)}`;
  return t(s);
}

// Перевод сообщений бэкенда (detail из HTTP-ошибок и test-connection).
// Сначала точное совпадение по словарю; для составных фраз — правила с префиксами.
const SERVER_PATTERNS = [
  [/^Moonraker недоступен: (.*)$/s, (m) => `${t("Moonraker недоступен:")} ${m[1]}`],
  [/^Подключено\. Состояние: (.*)$/s, (m) => `${t("Подключено. Состояние:")} ${m[1]}`],
  [/^Нет соединения: (.*)$/s, (m) => `${t("Нет соединения:")} ${m[1]}`],
  [/^Ошибка: (.*)$/s, (m) => `${t("Ошибка:")} ${m[1]}`],
  [/^Печать в статусе '(.*)' нельзя списать$/s, (m) => t("Печать в статусе «%s» нельзя списать").replace("%s", m[1])],
  [/ \(проверьте API-ключ\)/, () => ` ${t("(проверьте API-ключ)")}`],
];

export function tServer(s) {
  if (!s || getLang() !== "en") return s;
  const exact = t(s);
  if (exact !== s) return exact;
  for (const [re, fn] of SERVER_PATTERNS) {
    const m = s.match(re);
    if (m) return s.replace(re, fn(m));
  }
  return s;
}
