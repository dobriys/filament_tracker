import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Link as AriaLink } from "react-aria-components";
import { Table, TableCard } from "@/components/application/table/table";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Card, CardHeader, PageHeader, PageLoading, SpoolSwatch } from "../components/ft/ui.jsx";
import { NONE, Pick } from "../components/ft/form.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { api } from "../api/client.js";
import { t, tServer } from "../i18n.js";
import { slotLabel } from "../utils/slots.js";

// Плотность (г/см³) для оценки веса по длине — должна совпадать с backend.
const DENSITY = { PLA: 1.24, "PLA+": 1.24, PETG: 1.27, PET: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, TPE: 1.21, PC: 1.20, NYLON: 1.14, PA: 1.14, HIPS: 1.04, PVA: 1.23, PP: 0.90 };
function estimateGrams(mm, spool) {
  if (!mm || !spool) return null;
  const d = Number(spool.diameter_mm) || 1.75;
  const mat = (spool.material || "").toUpperCase().replace(/\s/g, "");
  const dens = DENSITY[mat] || DENSITY[mat.replace(/\+$/, "")] || 1.24;
  return Math.PI * (d / 2) ** 2 * Number(mm) / 1000 * dens;
}

const linkClass =
  "inline-flex cursor-pointer items-center gap-2 rounded-sm text-sm font-medium text-primary outline-focus-ring hover:text-brand-secondary focus-visible:outline-2 focus-visible:outline-offset-2";

// Списание печати: сопоставление Tool → катушка из инвентаря и подтверждение.
export default function ConsumeJob() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [spools, setSpools] = useState([]);
  const [slotMap, setSlotMap] = useState({});
  const [mapping, setMapping] = useState({});
  const [allowNegative, setAllowNegative] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/spools").then(setSpools).catch(() => {});
    api.get(`/api/print-jobs/${id}`).then(async (j) => {
      setJob(j);
      if (j.status === "consumed") { setResult(j); return; }
      const printers = await api.get("/api/printers").catch(() => []);
      const sm = {};
      const slotByIndex = {};
      for (const p of printers) {
        const slots = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        for (const s of slots) {
          if (s.current_spool_id) sm[s.current_spool_id] = `${p.name} / ${slotLabel(s, { detached: p.feed_state?.mode === "direct" })}`;
          if (p.id === j.printer_id && s.current_spool_id) slotByIndex[s.slot_index] = s.current_spool_id;
        }
      }
      setSlotMap(sm);
      const init = {};
      (j.tools || []).forEach((tool) => {
        const used = Number(tool.used_g) > 0 || Number(tool.used_mm) > 0;
        if (used && slotByIndex[tool.tool_index + 1]) init[tool.tool_index] = slotByIndex[tool.tool_index + 1];
      });
      setMapping(init);
    }).catch(() => {});
  }, [id]);

  const spoolById = (sid) => spools.find((s) => s.id === sid);

  async function confirm() {
    setError(null); setProblems(null); setBusy(true);
    try {
      const mappings = job.tools
        .filter((tool) => (Number(tool.used_g) > 0 || Number(tool.used_mm) > 0) && mapping[tool.tool_index])
        .map((tool) => ({ tool_index: tool.tool_index, spool_id: mapping[tool.tool_index] }));
      const res = await api.post(`/api/print-jobs/${id}/confirm-usage`, { mappings, allow_negative: allowNegative });
      setResult(res);
    } catch (err) {
      try {
        const e = JSON.parse(err.message);
        if (Array.isArray(e)) setProblems(e); else setError(err.message);
      } catch { setError(err.message); }
    }
    setBusy(false);
  }

  if (!job) return <PageLoading />;

  const crumbs = (last) => [{ label: t("История печати"), href: "/print-jobs" }, { label: last }];

  if (result) {
    return (
      <div>
        <PageHeader breadcrumbs={crumbs(t("Списание печати"))} title={`${t("✓ Списано —")} ${result.file_name}`} />
        <TableCard.Root>
          <Table size="sm" aria-label={t("Фактическое списание")}>
            <Table.Header>
              <Table.Head id="spool" isRowHeader label={t("Катушка")} className="w-full" />
              <Table.Head id="used" label={t("Списано, г")} className="px-3" />
            </Table.Header>
            <Table.Body items={result.spool_usage}>
              {(u) => {
                const sp = spoolById(u.spool_id);
                return (
                  <Table.Row id={u.id}>
                    <Table.Cell>
                      {sp ? (
                        <AriaLink href={`/spools/${u.spool_id}`} className={linkClass}>
                          <SpoolSwatch color={sp.color_hex} size="sm" />
                          {sp.label || t("Без метки")}
                        </AriaLink>
                      ) : (
                        <span className="text-sm text-tertiary">{u.spool_id?.slice(0, 8)}</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="px-3 tabular-nums">{Number(u.used_g).toFixed(2)}</Table.Cell>
                  </Table.Row>
                );
              }}
            </Table.Body>
          </Table>
        </TableCard.Root>
      </div>
    );
  }

  const total = job.total_filament_used_g != null
    ? `${Number(job.total_filament_used_g).toFixed(2)} ${t("г")}`
    : job.total_filament_used_mm > 0
      ? `${(Number(job.total_filament_used_mm) / 1000).toFixed(2)} ${t("м")}`
      : "—";

  const spoolItems = [
    { id: NONE, label: "—" },
    ...spools.map((s) => ({
      id: s.id,
      label: `${s.label || t("Без метки")}${s.material ? ` · ${s.material}` : ""}${s.color_name ? ` · ${s.color_name}` : ""} · ${Number(s.current_weight_g).toFixed(0)} ${t("г")}${slotMap[s.id] ? ` · [${slotMap[s.id]}]` : ""}`,
    })),
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={crumbs(t("Списание печати"))}
        title={t("Списание печати")}
        subtitle={`${job.file_name} · ${job.slicer_name || "?"} ${t("· всего")} ${total}`}
      />
      {error && <Notice tone="error" className="mb-6" onClose={() => setError(null)}>{error}</Notice>}

      <Card>
        <CardHeader
          title={t("Какой катушкой печатался каждый инструмент")}
          description={t("Слева — что в печати, справа — катушка из инвентаря.")}
        />
        <div className="hidden grid-cols-[200px_160px_minmax(0,1fr)] gap-4 border-b border-secondary px-5 py-2.5 text-xs font-medium text-tertiary md:grid">
          <span>{t("Инструмент")}</span>
          <span>{t("Расход")}</span>
          <span>{t("Катушка из инвентаря")}</span>
        </div>
        <div className="divide-y divide-secondary">
          {job.tools.map((tool) => {
            const grams = Number(tool.used_g) || 0;
            const mm = Number(tool.used_mm) || 0;
            const unused = grams <= 0 && mm <= 0;
            const byLength = grams <= 0 && mm > 0;
            const sp = spoolById(mapping[tool.tool_index]);
            const est = byLength ? estimateGrams(mm, sp) : null;
            return (
              <div key={tool.id} className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[200px_160px_minmax(0,1fr)] md:gap-4">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold text-primary">Tool {tool.tool_index}</p>
                  <p className="m-0 mt-1 flex items-center gap-2 text-sm text-tertiary">
                    <SpoolSwatch color={tool.color_hex} size="sm" />
                    <span className="truncate">{tool.material || "—"} {tool.color_hex || ""}</span>
                  </p>
                </div>
                <div className="text-sm text-primary tabular-nums md:pt-0.5">
                  {unused ? <span className="text-tertiary">{t("не используется")}</span>
                    : byLength
                      ? <span title={t("Слайсер не дал вес — оценка по длине и выбранной катушке")}>
                          {est != null ? `≈ ${est.toFixed(1)} ${t("г")}` : "≈ ?"}{" "}
                          <span className="text-tertiary">({(mm / 1000).toFixed(2)} {t("м")})</span>
                        </span>
                      : `${grams.toFixed(2)} ${t("г")}`}
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <Pick
                    label={t("Катушка из инвентаря")}
                    className="md:**:data-label:hidden"
                    placeholder={unused ? "—" : t("— выбрать катушку —")}
                    isDisabled={unused}
                    value={mapping[tool.tool_index] || NONE}
                    onChange={(k) => setMapping({ ...mapping, [tool.tool_index]: k === NONE ? "" : k })}
                    items={spoolItems}
                  />
                  {sp && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <SpoolSwatch color={sp.color_hex} size="sm" />
                      <span className="font-semibold text-primary">{sp.label || t("Без метки")}</span>
                      <span className="text-tertiary">{[sp.material, sp.color_name].filter(Boolean).join(" · ")}</span>
                      <span className="text-tertiary">· {Number(sp.current_weight_g).toFixed(0)} {t("г")}</span>
                      {slotMap[sp.id] && <Badge size="sm" color="brand" type="pill-color">{slotMap[sp.id]}</Badge>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 border-t border-secondary p-5">
          <Checkbox size="sm" isSelected={allowNegative} onChange={setAllowNegative} label={t("Разрешить списание в минус (если не хватает остатка)")} />
          {problems && (
            <Notice tone="error" title={t("Нельзя списать:")}>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {problems.map((p, i) => (
                  <li key={i}>
                    {p.tool_index != null ? `Tool ${p.tool_index}: ` : ""}{tServer(p.detail)}
                    {p.needed_g != null && ` ${t("(нужно")} ${p.needed_g} ${t("г, есть")} ${p.available_g} ${t("г)")}`}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <div>
            <Button size="md" isLoading={busy} onClick={confirm}>{t("Подтвердить списание")}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
