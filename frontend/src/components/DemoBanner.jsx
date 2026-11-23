import { Link as AriaLink } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { DEMO, resetDemo } from "../api/demo.js";
import { t } from "../i18n.js";

// Плашка демо-режима: поясняет, что данные не сохраняются, и даёт сброс.
export default function DemoBanner() {
  if (!DEMO) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-utility-orange-500 bg-tertiary px-4 py-1.5 text-sm text-primary">
      {/* Точка внутри текстового блока: иначе на узком экране она переносится
          на отдельную строку и висит сама по себе. */}
      <span className="min-w-52 flex-1">
        <span className="mr-1.5 animate-pulse text-xs text-utility-orange-500" aria-hidden="true">●</span>
        <b className="font-bold">{t("Демо")}</b> — {t("данные живут только в этом браузере и не сохраняются на сервере.")}
      </span>
      <AriaLink
        href="https://github.com/dobriys/filament_tracker"
        target="_blank"
        rel="noreferrer"
        className="cursor-pointer rounded-sm text-xs whitespace-nowrap text-tertiary underline outline-focus-ring hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        GitHub ↗
      </AriaLink>
      <Button size="sm" color="secondary" onClick={() => resetDemo()}>
        {t("Сбросить демо")}
      </Button>
    </div>
  );
}
