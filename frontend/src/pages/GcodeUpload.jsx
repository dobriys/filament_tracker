import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button as AriaButton } from "react-aria-components";
import { Upload01 } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { Button } from "@/components/base/buttons/button";
import { Card, PageHeader, SpoolSwatch } from "../components/ft/ui.jsx";
import { NONE, Pick } from "../components/ft/form.jsx";
import { Notice, Stat } from "../components/ft/printer.jsx";
import { api } from "../api/client.js";
import { t } from "../i18n.js";

function fmtTime(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h ? h + t("ч") + " " : ""}${m}${t("м")}`;
}
// «Слайсер:» → «Слайсер»: подпись плитки без двоеточия, перевод тот же.
const bare = (s) => s.replace(/:\s*$/, "");

export default function GcodeUpload() {
  const [printers, setPrinters] = useState([]);
  const [printerId, setPrinterId] = useState("");
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/printers").then(setPrinters).catch(() => {});
  }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null); setParsed(null); setBusy(true);
    try {
      setParsed(await api.postFile("/api/gcode/parse", file));
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  async function createAndConsume() {
    setError(null);
    try {
      const j = await api.post("/api/print-jobs", { printer_id: printerId || null, parsed });
      navigate(`/print-jobs/${j.id}/consume`);
    } catch (err) { setError(err.message); }
  }

  const printerItems = [{ id: NONE, label: t("— без привязки —") }, ...printers.map((p) => ({ id: p.id, label: p.name }))];

  return (
    <div>
      <PageHeader title={t("Загрузка gcode")} />

      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <Pick
            label={t("Принтер (необязательно — подставит катушки из слотов)")}
            value={printerId || NONE}
            onChange={(k) => setPrinterId(k === NONE ? "" : k)}
            items={printerItems}
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-secondary">{t("Файл .gcode / .bgcode")}</p>
            <AriaButton
              onPress={() => fileRef.current?.click()}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-primary bg-secondary_alt px-4 py-2 text-left text-sm outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Upload01 className="size-5 shrink-0 text-fg-quaternary" aria-hidden="true" />
              <span className="truncate text-secondary">{fileName || t("Выбрать файл…")}</span>
            </AriaButton>
            <input ref={fileRef} type="file" accept=".gcode,.bgcode,.g,.gco" className="hidden" onChange={onFile} />
          </div>
        </div>
        {busy && <p className="m-0 px-5 pb-5 text-sm text-tertiary">{t("Обработка…")}</p>}
        {error && <div className="px-5 pb-5"><Notice tone="error" onClose={() => setError(null)}>{error}</Notice></div>}
      </Card>

      {parsed && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={bare(t("Слайсер:"))}>{`${parsed.slicer_name || "?"} ${parsed.slicer_version || ""}`}</Stat>
            <Stat label={bare(t("Время:"))}>{fmtTime(parsed.estimated_print_time_sec)}</Stat>
            <Stat label={bare(t("Смен филамента:"))}>{parsed.filament_change_count ?? "—"}</Stat>
            <Stat label={bare(t("Итого:"))}>
              {parsed.total_filament_used_g != null ? `${parsed.total_filament_used_g.toFixed(2)} ${t("г")}` : "—"}
            </Stat>
          </div>

          <TableCard.Root>
            <Table size="sm" aria-label={t("Инструмент")}>
              <Table.Header>
                <Table.Head id="tool" isRowHeader label={t("Инструмент")} />
                <Table.Head id="material" label={t("Материал")} className="px-3" />
                <Table.Head id="color" label={t("Цвет")} className="w-full px-3" />
                <Table.Head id="g" label={t("Расход, г")} className="px-3" />
                <Table.Head id="mm" label={t("Расход, мм")} className="px-3" />
              </Table.Header>
              <Table.Body items={parsed.tools.map((tool) => ({ ...tool, id: tool.tool_index }))}>
                {(tool) => (
                  <Table.Row id={tool.id}>
                    <Table.Cell className="font-medium whitespace-nowrap text-primary">Tool {tool.tool_index}</Table.Cell>
                    <Table.Cell className="px-3">{tool.material || "—"}</Table.Cell>
                    <Table.Cell className="px-3">
                      {tool.color_hex ? (
                        <span className="inline-flex items-center gap-2">
                          <SpoolSwatch color={tool.color_hex} size="sm" />
                          <span className="font-mono text-sm text-tertiary">{tool.color_hex}</span>
                        </span>
                      ) : "—"}
                    </Table.Cell>
                    <Table.Cell className="px-3 tabular-nums">{tool.used_g != null ? tool.used_g.toFixed(2) : "—"}</Table.Cell>
                    <Table.Cell className="px-3 tabular-nums">{tool.used_mm != null ? tool.used_mm.toFixed(0) : "—"}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </TableCard.Root>

          <div>
            <Button size="md" onClick={createAndConsume}>{t("Создать печать и списать →")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
