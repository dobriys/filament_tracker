import { useEffect, useState } from "react";
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
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <b>{t("Доступна новая версия")}</b>{" "}
        <span className="mono">{info.latest_version}</span>
      </div>
      <div className="update-toast-actions">
        {info.release_url && (
          <a className="update-toast-link" href={info.release_url} target="_blank" rel="noreferrer">
            {t("Что нового")} ↗
          </a>
        )}
        <button className="update-toast-close" onClick={() => setInfo(null)} aria-label={t("Закрыть")}>×</button>
      </div>
    </div>
  );
}
