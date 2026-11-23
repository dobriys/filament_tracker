// Переключение темы. Токены Untitled UI переключаются классом dark-mode на
// <html>; атрибут data-theme ставим рядом — по нему тему удобно читать из
// кода и инструментов отладки. Выбор хранится в localStorage и применяется
// без перезагрузки.
const KEY = "ft_theme";

function apply(v) {
  const root = document.documentElement;
  root.dataset.theme = v;
  root.classList.toggle("dark-mode", v === "dark");
}

export function getTheme() {
  return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
}

export function setTheme(v) {
  localStorage.setItem(KEY, v);
  apply(v);
}

// применить сохранённую тему при загрузке модуля
apply(getTheme());
