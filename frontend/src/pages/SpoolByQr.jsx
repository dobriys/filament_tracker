import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/base/buttons/button";
import { Card, PageHeader, PageLoading, SpecRow, SpoolSwatch } from "../components/ft/ui.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { api } from "../api/client.js";
import { t } from "../i18n.js";

// Страница, на которую ведёт QR с этикетки катушки: краткая карточка и ссылка
// на полную страницу.
export default function SpoolByQr() {
  const { token } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    setCard(null);
    api
      .get(`/api/spools/by-qr/${token}`)
      .then(setCard)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!card) return <PageLoading />;

  const title = [card.brand, card.name].filter(Boolean).join(" ") || card.label;
  const rows = [
    [t("Материал"), card.material || "—"],
    [t("Цвет"), [card.color_name, card.color_hex].filter(Boolean).join(" ") || "—"],
    [t("Сопло"), card.nozzle_temp || "—"],
    [t("Стол"), card.bed_temp || "—"],
    [t("Диаметр"), card.diameter_mm ? `${card.diameter_mm} ${t("мм")}` : "—"],
    [t("Плотность"), card.density_g_cm3 ? `${card.density_g_cm3} ${t("г/см³")}` : "—"],
    [t("Остаток"), `${Number(card.remaining_g).toFixed(0)} ${t("г")}`],
    [t("Хранение"), card.location_name || "—"],
    [t("Открыта"), card.opened_date || "—"],
  ];

  return (
    <div>
      <PageHeader title={t("Катушка")} />
      <Card className="max-w-2xl">
        <div className="flex flex-col-reverse gap-6 p-5 sm:flex-row sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-3">
              {card.color_hex && <SpoolSwatch color={card.color_hex} size="md" />}
              <h2 className="m-0 text-lg font-semibold text-primary">{title}</h2>
            </div>
            <div className="flex flex-col">
              {rows.map(([k, v]) => <SpecRow key={k} label={k}>{v}</SpecRow>)}
            </div>
          </div>
          {card.qr_png_base64 && (
            <img src={card.qr_png_base64} alt="QR" width={120} height={120} className="size-30 shrink-0 self-start rounded-lg bg-white p-1 ring-1 ring-secondary" />
          )}
        </div>
      </Card>
      <div className="mt-6">
        <Button size="md" color="link-color" href={`/spools/${card.spool_id}`}>{t("→ Открыть полную страницу катушки")}</Button>
      </div>
    </div>
  );
}
