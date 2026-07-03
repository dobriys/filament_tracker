// Переключение темы. Палитры заданы в styles.css: :root — тёмная,
// [data-theme="light"] — светлая. Атрибут ставится на <html>; выбор
// сохраняется в localStorage и применяется без перезагрузки.
const KEY = "ft_theme";

export function getTheme() {
  return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
}

export function setTheme(v) {
  localStorage.setItem(KEY, v);
  document.documentElement.dataset.theme = v;
}

// применить сохранённую тему при загрузке модуля
document.documentElement.dataset.theme = getTheme();
