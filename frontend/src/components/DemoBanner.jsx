import { DEMO, resetDemo } from "../api/demo.js";
import { t } from "../i18n.js";

// Плашка демо-режима: поясняет, что данные не сохраняются, и даёт сброс.
export default function DemoBanner() {
  if (!DEMO) return null;
  return (
    <div className="demo-banner">
      <span className="demo-banner-dot" aria-hidden="true">●</span>
      <span className="demo-banner-text">
        <b>{t("Демо")}</b> — {t("данные живут только в этом браузере и не сохраняются на сервере.")}
      </span>
      <a
        className="demo-banner-link"
        href="https://github.com/dobriys/filament_tracker"
        target="_blank"
        rel="noreferrer"
      >
        GitHub ↗
      </a>
      <button className="demo-banner-reset" onClick={() => resetDemo()}>
        {t("Сбросить демо")}
      </button>
    </div>
  );
}
