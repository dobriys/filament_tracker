import { useEffect, useState } from "react";
import { Link as AriaLink } from "react-aria-components";
import { XClose } from "@untitledui/icons";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { api } from "../api/client.js";
import { t } from "../i18n.js";

const SEEN_KEY = "ft_update_seen_version";

// Всплывающая карточка «вышла новая версия» — один раз на версию. Флаг «видели»
// пишется сразу, как только решили её показать, а не только по клику на
// закрытие: иначе обновление страницы до клика показало бы её снова.
export default function UpdateToast() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.get("/api/updates/latest").then((r) => {
      if (!r?.update_available || !r.latest_version) return;
      if (localStorage.getItem(SEEN_KEY) === r.latest_version) return;
      localStorage.setItem(SEEN_KEY, r.latest_version);
      setInfo(r);
    }).catch(() => {});
  }, []);

  if (!info) return null;

  return (
    <div
      role="status"
      className="fixed top-4 right-4 z-60 flex max-w-[min(360px,calc(100vw-32px))] items-center gap-3 rounded-xl bg-primary px-3.5 py-2.5 text-sm shadow-lg ring-1 ring-secondary"
    >
      <div className="min-w-0 flex-1 text-primary">
        <b className="font-semibold">{t("Доступна новая версия")}</b>{" "}
        <span className="font-mono">{info.latest_version}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {info.release_url && (
          <AriaLink
            href={info.release_url}
            target="_blank"
            rel="noreferrer"
            className="cursor-pointer rounded-sm font-medium whitespace-nowrap text-brand-secondary underline outline-focus-ring hover:text-brand-secondary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("Что нового")} ↗
          </AriaLink>
        )}
        <ButtonUtility size="xs" color="tertiary" icon={XClose} tooltip={t("Закрыть")} onClick={() => setInfo(null)} />
      </div>
    </div>
  );
}
