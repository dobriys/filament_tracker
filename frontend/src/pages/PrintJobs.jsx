import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link as AriaLink } from "react-aria-components";
import { XClose } from "@untitledui/icons";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Table, TableCard } from "@/components/application/table/table";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { EmptyNote, PageHeader, SpoolSwatch } from "../components/ft/ui.jsx";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, dateLocale } from "../i18n.js";

// Статусы, из которых печать ещё можно списать. Совпадают с проверкой на
// бэкенде (print_job_service.confirm_usage) — иначе кнопка вела бы в отказ.
const CONSUMABLE = new Set(["draft", "ready_to_consume"]);

const STATUS = {
  draft: t("черновик"),
  ready_to_consume: t("готово к списанию"),
  consumed: t("списано"),
  cancelled: t("отменено"),
  error: t("ошибка"),
  archived: t("архив"),
};
const STATUS_COLOR = {
  draft: "gray", ready_to_consume: "warning", consumed: "success",
  cancelled: "gray", error: "error", archived: "gray",
};

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(dateLocale(), { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
}

// Расход печати одной ячейкой. Граммов может не быть вовсе: у временных
// .3mf-файлов Anycubic слайсерских метаданных нет, а у оборванной печати итог
// слайсера намеренно не берётся — от принтера приходит только длина. Поэтому
// три источника по убыванию точности: факт списания → итог слайсера → длина.
function Usage({ job }) {
  const consumed = Number(job.consumed_g) || 0;
  if (consumed > 0) {
    return <span title={t("Фактически списано с катушек")}>{consumed.toFixed(2)}{" "}{t("г")}</span>;
  }
  if (job.total_filament_used_g != null) {
    return <>{Number(job.total_filament_used_g).toFixed(2)}{" "}{t("г")}</>;
  }
  const mm = Number(job.total_filament_used_mm) || 0;
  if (mm > 0) {
    return (
      <span className="text-tertiary" title={t("Слайсер не дал вес — граммы посчитаются по выбранной катушке при списании")}>
        {(mm / 1000).toFixed(2)}{" "}{t("м")}
      </span>
    );
  }
  return "—";
}

function StatusBadge({ status }) {
  return (
    <BadgeWithDot type="pill-color" size="sm" color={STATUS_COLOR[status] || "gray"}>
      {STATUS[status] || status}
    </BadgeWithDot>
  );
}

export default function PrintJobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [spoolMap, setSpoolMap] = useState({});

  function load() {
    api.get("/api/print-jobs").then(setJobs).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get("/api/spools").then((ss) => setSpoolMap(Object.fromEntries(ss.map((s) => [s.id, s])))).catch(() => {});
  }, []);

  async function open(id) {
    setDetail(await api.get(`/api/print-jobs/${id}`));
  }
  async function cancel(id) {
    await api.post(`/api/print-jobs/${id}/cancel`);
    setDetail(null);
    load();
  }
  async function toggleFailed(job) {
    setDetail(await api.post(`/api/print-jobs/${job.id}/mark-failed`, { failed: !job.failed }));
    load();
  }

  return (
    <div>
      <PageHeader
        title={t("История печати")}
        badge={<Badge size="sm" color="brand" type="pill-color">{jobs.length}</Badge>}
      />

      <TableCard.Root>
        <Table size="sm" aria-label={t("История печати")} onRowAction={(key) => open(String(key))}>
          <Table.Header>
            <Table.Head id="date" isRowHeader label={t("Дата")} />
            <Table.Head id="file" label={t("Файл")} className="w-full" />
            <Table.Head id="usage" label={t("Расход")} className="px-3" />
            <Table.Head id="price" label={t("Цена")} className="px-3" />
            <Table.Head id="status" label={t("Статус")} className="px-3" />
            <Table.Head id="actions" className="px-3" />
          </Table.Header>
          <Table.Body items={jobs} renderEmptyState={() => <EmptyNote>{t("Печатей пока нет")}</EmptyNote>}>
            {(j) => (
              <Table.Row id={j.id}>
                <Table.Cell className="whitespace-nowrap text-tertiary">{fmtWhen(j.completed_at || j.created_at)}</Table.Cell>
                <Table.Cell>
                  <p className="max-w-md truncate text-sm font-medium text-primary" title={j.file_name || ""}>
                    {(j.file_name || "—").split("/").pop()}
                  </p>
                  {j.slicer_name && <p className="text-sm text-tertiary">{j.slicer_name}</p>}
                </Table.Cell>
                <Table.Cell className="px-3 whitespace-nowrap tabular-nums"><Usage job={j} /></Table.Cell>
                <Table.Cell
                  className="px-3 whitespace-nowrap tabular-nums"
                >
                  <span title={j.cost_partial ? t("Часть катушек без цены — итог занижен") : undefined}>
                    {j.cost != null ? <>{fmtMoney(j.cost, j.cost_currency)}{j.cost_partial ? <span className="text-tertiary">*</span> : null}</> : "—"}
                  </span>
                </Table.Cell>
                <Table.Cell className="px-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={j.status} />
                    {j.failed && <Badge size="sm" color="error" type="pill-color">{t("брак")}</Badge>}
                  </div>
                </Table.Cell>
                <Table.Cell className="px-3">
                  <div className="flex items-center justify-end gap-2">
                    {CONSUMABLE.has(j.status) && (
                      <Button size="sm" onClick={() => navigate(`/print-jobs/${j.id}/consume`)}>{t("Списать")}</Button>
                    )}
                    <Button size="sm" color="secondary" onClick={() => open(j.id)}>{t("Открыть")}</Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </TableCard.Root>

      {/* Подробности печати: фактическое списание, себестоимость, действия */}
      <ModalOverlay isDismissable isOpen={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <Modal className="max-w-2xl">
          <Dialog aria-label={detail?.file_name || t("История печати")}>
            {detail && (
              <div className="flex flex-col gap-5 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 text-lg font-semibold break-words text-primary">{detail.file_name}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={detail.status} />
                      {detail.failed && <Badge size="sm" color="error" type="pill-color">{t("брак")}</Badge>}
                    </div>
                  </div>
                  <ButtonUtility size="sm" color="tertiary" icon={XClose} tooltip={t("Закрыть")} onClick={() => setDetail(null)} />
                </div>

                {detail.spool_usage.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="m-0 text-md font-semibold text-primary">{t("Фактическое списание")}</h3>
                    <TableCard.Root>
                      <Table size="sm" aria-label={t("Фактическое списание")}>
                        <Table.Header>
                          <Table.Head id="spool" isRowHeader label={t("Катушка")} className="w-full" />
                          <Table.Head id="used" label={t("Списано, г")} className="px-3" />
                          <Table.Head id="at" label={t("Подтверждено")} className="px-3" />
                        </Table.Header>
                        <Table.Body items={detail.spool_usage}>
                          {(u) => {
                            const sp = spoolMap[u.spool_id];
                            return (
                              <Table.Row id={u.id}>
                                <Table.Cell>
                                  {sp ? (
                                    <AriaLink
                                      href={`/spools/${u.spool_id}`}
                                      className="inline-flex cursor-pointer items-center gap-2 rounded-sm text-sm font-medium text-primary outline-focus-ring hover:text-brand-secondary focus-visible:outline-2 focus-visible:outline-offset-2"
                                    >
                                      <SpoolSwatch color={sp.color_hex} size="sm" />
                                      <span>
                                        {sp.label || t("Без метки")}
                                        {sp.material && <span className="font-normal text-tertiary"> · {sp.material}</span>}
                                      </span>
                                    </AriaLink>
                                  ) : (
                                    <span className="text-sm text-tertiary">{t("катушка удалена (")}{String(u.spool_id).slice(0, 8)})</span>
                                  )}
                                </Table.Cell>
                                <Table.Cell className="px-3 tabular-nums">{Number(u.used_g).toFixed(2)}</Table.Cell>
                                <Table.Cell className="px-3 whitespace-nowrap">
                                  {u.confirmed_at ? new Date(u.confirmed_at).toLocaleString(dateLocale()) : "—"}
                                </Table.Cell>
                              </Table.Row>
                            );
                          }}
                        </Table.Body>
                      </Table>
                    </TableCard.Root>
                    {detail.cost != null && (
                      <p className="m-0 text-sm font-semibold text-primary">
                        {t("Себестоимость печати:")} {fmtMoney(detail.cost, detail.cost_currency)}
                        {detail.cost_partial && <span className="font-normal text-tertiary"> {t("(часть катушек без цены)")}</span>}
                      </p>
                    )}
                  </div>
                )}

                {detail.status === "consumed" && (
                  <div>
                    <Button size="md" color={detail.failed ? "secondary" : "secondary-destructive"} onClick={() => toggleFailed(detail)}>
                      {detail.failed ? t("✓ Брак — снять пометку") : t("Пометить как брак")}
                    </Button>
                  </div>
                )}
                {detail.status !== "consumed" && detail.status !== "cancelled" && (
                  <div className="flex flex-wrap gap-3">
                    {CONSUMABLE.has(detail.status) && (
                      <Button size="md" onClick={() => navigate(`/print-jobs/${detail.id}/consume`)}>{t("Списать")}</Button>
                    )}
                    <Button size="md" color="primary-destructive" onClick={() => cancel(detail.id)}>{t("Отменить печать")}</Button>
                  </div>
                )}
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
