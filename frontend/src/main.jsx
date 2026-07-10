import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./api/auth.jsx";
import { api } from "./api/client.js";
import { DEMO } from "./api/demo.js";
import DemoBanner from "./components/DemoBanner.jsx";
import "./styles.css";

// Глобальный перехват ошибок браузера → диагностический журнал (если включён).
// Бэкенд решает, сохранять ли; клиент просто сообщает.
window.addEventListener("error", (e) => {
  api.reportError({
    message: e.message,
    kind: e.error?.name,
    path: location.hash || location.pathname,
    stack: e.error?.stack,
  });
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  api.reportError({
    message: r?.message || String(r),
    kind: r?.name || "UnhandledRejection",
    path: location.hash || location.pathname,
    stack: r?.stack,
  });
});

// В демо (статичный хостинг вроде GitHub Pages) используем HashRouter — deep-link
// и перезагрузка страницы работают без серверных rewrite-правил.
const Router = DEMO ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <DemoBanner />
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>
);

// PWA: service worker только в прод-сборке (в dev мешает hot-reload).
// В демо не регистрируем — статичный кеш мешал бы обновлениям и сбросу.
if (import.meta.env.PROD && !DEMO && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
