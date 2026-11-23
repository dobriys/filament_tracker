import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Copy01, Edit01, Grid01, List, MarkerPin01, Plus, Printer, SearchLg, Trash01 } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { Badge } from "@/components/base/badges/badges";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Card, EmptyNote, PageHeader, RemainingBar, SpoolStatusBadge, SpoolSwatch } from "../components/ft/ui.jsx";
import { api } from "../api/client.js";
import { MATERIALS } from "../specFields.js";
import { t } from "../i18n.js";
import { slotLabel } from "../utils/slots.js";
import { locationPath } from "../utils/locations.js";
import { lowThresholdFor, spoolTitle } from "../utils/spools.js";

const STATUS_LABELS = {
  new: t("новая"),
  in_use: t("используется"),
  almost_empty: t("почти закончилась"),
  empty: t("закончилась"),
  archived: t("архив"),
};
const ALL = "__all";

export default function Spools() {
  const [spools, setSpools] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  // На узких экранах сетка (карточки) читается лучше «списка»-таблицы.
  const [view, setView] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "grid" : "list"
  );
  const [search, setSearch] = useState("");
  const [matFilter, setMatFilter] = useState(ALL);
  const [locFilter, setLocFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [slotMap, setSlotMap] = useState({}); // spool_id -> "Printer / Slot N"
  const navigate = useNavigate();

  function load() {
    api.get("/api/spools").then(setSpools).catch(() => {});
  }
  useEffect(() => {
    load();
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
    api.get("/api/locations").then(setLocations).catch(() => {});
    (async () => {
      const printers = await api.get("/api/printers").catch(() => []);
      const sm = {};
      for (const p of printers) {
        const slots = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        const detached = p.feed_state?.mode === "direct";
        for (const s of slots) if (s.current_spool_id) sm[s.current_spool_id] = `${p.name} / ${slotLabel(s, { detached })}`;
      }
      setSlotMap(sm);
    })();
  }, []);

  const profMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const locMap = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations]);

  function enrich(s) {
    const p = profMap[s.filament_profile_id];
    const remaining = Number(s.current_weight_g);
    const capacity = Number(s.initial_filament_weight_g) || 1000;
    const pct = Math.max(0, Math.min(1, remaining / capacity));
    // Тот же порог, что у enrichSpool и у статуса на сервере: доля от ёмкости
    // именно этой катушки, подрезанная зажимами.
    const low = s.status === "empty" || remaining <= lowThresholdFor(capacity);
    const brand = s.manufacturer || p?.brand;
    const name = p?.name || s.label;
    return {
      p, remaining, pct, low,
      title: spoolTitle(brand, name),
      sku: s.sku || s.label || "",
      material: s.material || p?.material || "—",
      colorName: s.color_name || p?.color_name || "",
      colorHex: s.color_hex || p?.color_hex,
      locName: s.location_id ? locMap[s.location_id]?.name : null,
      slotLabel: slotMap[s.id] || null,
    };
  }

  const rows = useMemo(() => {
    return spools
      .map((s) => ({ s, e: enrich(s) }))
      .filter(({ s, e }) => {
        // По умолчанию скрываем архив; показываем, только если выбран статус «архив».
        if (statusFilter === ALL && s.status === "archived") return false;
        if (matFilter !== ALL && e.material !== matFilter) return false;
        if (locFilter !== ALL && s.location_id !== locFilter) return false;
        if (statusFilter !== ALL && s.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!`${e.title} ${e.sku} ${e.material} ${e.colorName}`.toLowerCase().includes(q)) return false;
        }
        return true;
      });
  }, [spools, profMap, locMap, slotMap, matFilter, locFilter, statusFilter, search]);

  const selectedIds = [...selectedKeys].filter((id) => rows.some(({ s }) => s.id === id));
  const onSelectionChange = (keys) => setSelectedKeys(keys === "all" ? new Set(rows.map(({ s }) => s.id)) : new Set(keys));
  const clearSelection = () => setSelectedKeys(new Set());

  async function printA4() {
    await api.download("/api/spools/labels.pdf", {
      method: "POST", body: { spool_ids: selectedIds, format: "card" }, filename: "labels-a4.pdf",
    });
  }
  async function archive(id) { await api.patch(`/api/spools/${id}`, { status: "archived" }); load(); }
  async function unarchive(id) { await api.patch(`/api/spools/${id}`, { status: "in_use" }); load(); }
  async function duplicate(id) {
    const copy = await api.post(`/api/spools/${id}/duplicate?new_color=true`);
    navigate(`/spools/${copy.id}/edit`);
  }
  async function deleteSpool(id) {
    if (!window.confirm(t("Удалить катушку? Действие необратимо (история списаний по ней тоже удалится)."))) return;
    await api.del(`/api/spools/${id}`);
    load();
  }
  async function bulkArchive() {
    await Promise.all(selectedIds.map((id) => api.patch(`/api/spools/${id}`, { status: "archived" })));
    clearSelection(); load();
  }
  async function bulkDelete() {
    if (!window.confirm(`${t("Удалить выбранные катушки")} (${selectedIds.length})? ${t("Необратимо.")}`)) return;
    await Promise.all(selectedIds.map((id) => api.del(`/api/spools/${id}`)));
    clearSelection(); load();
  }

  // Шкала остатка окрашена самим филаментом: полоса показывает, сколько
  // осталось именно этого цвета. Ниже порога цвет перебивается красным —
  // тревога должна читаться раньше материала. Порог один на всё приложение
  // (см. utils/spools.js).
  const barColor = (e) => (e.low ? "var(--color-utility-red-500, #f04438)" : e.colorHex || "var(--color-bg-quaternary)");

  const matItems = [{ id: ALL, label: t("Материал: все") }, ...MATERIALS.map((m) => ({ id: m, label: m }))];
  const locItems = [{ id: ALL, label: t("Место: все") }, ...locations.map((l) => ({ id: l.id, label: locationPath(locations, l.id) }))];
  const statusItems = [{ id: ALL, label: t("Статус: активные") }, ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ id: k, label: v }))];

  const where = (e, iconOnly) =>
    e.slotLabel ? (
      <span className="inline-flex max-w-36 items-center gap-1 rounded-full bg-utility-brand-50 px-2 py-0.5 text-xs font-medium text-utility-brand-700 ring-1 ring-utility-brand-200 ring-inset" title={e.slotLabel}>
        <Printer className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{e.slotLabel}</span>
      </span>
    ) : e.locName ? (
      <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
        <MarkerPin01 className="size-4 text-fg-quaternary" aria-hidden="true" /> {e.locName}
      </span>
    ) : (
      <span className="text-sm text-quaternary">{iconOnly ? t("не указано") : "—"}</span>
    );

  const rowMenu = (s) => (
    <Dropdown.Root>
      <Dropdown.DotsButton />
      <Dropdown.Popover className="w-min">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "edit") navigate(`/spools/${s.id}/edit`);
            else if (key === "copy") duplicate(s.id);
            else if (key === "archive") (s.status === "archived" ? unarchive(s.id) : archive(s.id));
            else if (key === "delete") deleteSpool(s.id);
          }}
        >
          <Dropdown.Item id="edit" icon={Edit01}><span className="pr-4">{t("Редактировать")}</span></Dropdown.Item>
          <Dropdown.Item id="copy" icon={Copy01}><span className="pr-4">{t("Дублировать (новый цвет)")}</span></Dropdown.Item>
          <Dropdown.Item id="archive" icon={Archive}>
            <span className="pr-4">{s.status === "archived" ? t("Из архива") : t("В архив")}</span>
          </Dropdown.Item>
          <Dropdown.Separator />
          <Dropdown.Item id="delete" icon={Trash01}><span className="pr-4">{t("Удалить")}</span></Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  );

  return (
    <div>
      <PageHeader
        title={t("Катушки")}
        subtitle={t("Управление катушками и отслеживание остатка.")}
        badge={<Badge size="sm" color="brand" type="pill-color">{rows.length}</Badge>}
        actions={
          <>
            <ButtonGroup
              size="md"
              aria-label={t("Вид")}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[view]}
              onSelectionChange={(keys) => setView([...keys][0] || "list")}
            >
              <ButtonGroupItem id="list" iconLeading={List}>{t("Список")}</ButtonGroupItem>
              <ButtonGroupItem id="grid" iconLeading={Grid01}>{t("Сетка")}</ButtonGroupItem>
            </ButtonGroup>
            <Button size="md" iconLeading={Plus} onClick={() => navigate("/spools/new")}>{t("Добавить катушку")}</Button>
          </>
        }
      />

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          size="sm"
          icon={SearchLg}
          placeholder={t("Поиск по названию или метке…")}
          value={search}
          onChange={setSearch}
          className="w-full sm:w-72"
        />
        <Select size="sm" aria-label={t("Материал")} items={matItems} selectedKey={matFilter} onSelectionChange={(k) => setMatFilter(String(k))} className="w-full sm:w-44">
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
        <Select size="sm" aria-label={t("Место")} items={locItems} selectedKey={locFilter} onSelectionChange={(k) => setLocFilter(String(k))} className="w-full sm:w-52">
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
        <Select size="sm" aria-label={t("Статус")} items={statusItems} selectedKey={statusFilter} onSelectionChange={(k) => setStatusFilter(String(k))} className="w-full sm:w-52">
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <span className="text-sm text-tertiary">{t("Выбрано:")} {selectedIds.length}</span>
              <Button size="sm" color="secondary" onClick={printA4}>{t("Печать A4")}</Button>
              <Button size="sm" color="secondary" onClick={bulkArchive}>{t("В архив")}</Button>
              <Button size="sm" color="primary-destructive" onClick={bulkDelete}>{t("Удалить")}</Button>
            </>
          )}
        </div>
      </div>

      {view === "list" ? (
        <TableCard.Root>
          <Table
            size="sm"
            aria-label={t("Катушки")}
            selectionMode="multiple"
            selectedKeys={selectedKeys}
            onSelectionChange={onSelectionChange}
            onRowAction={(key) => navigate(`/spools/${key}`)}
          >
            <Table.Header>
              <Table.Head id="spool" isRowHeader label={t("Катушка")} className="w-full" />
              <Table.Head id="material" label={t("Материал")} className="px-3" />
              <Table.Head id="status" label={t("Статус")} className="px-3" />
              <Table.Head id="where" label={t("Где находится")} className="px-3" />
              <Table.Head id="left" label={t("Остаток")} className="min-w-40 px-3" />
              <Table.Head id="actions" className="px-3" />
            </Table.Header>
            <Table.Body items={rows} renderEmptyState={() => <EmptyNote>{t("Ничего не найдено")}</EmptyNote>}>
              {({ s, e }) => (
                <Table.Row id={s.id}>
                  <Table.Cell>
                    <div className="flex items-center gap-3">
                      <SpoolSwatch color={e.colorHex} />
                      <div className="min-w-0">
                        <p className="max-w-56 truncate text-sm font-medium text-primary">{e.title}</p>
                        <p className="max-w-56 truncate text-sm text-tertiary">
                          {[e.colorName, e.colorHex].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="px-3"><Badge size="sm" color="gray" type="pill-color">{e.material}</Badge></Table.Cell>
                  <Table.Cell className="px-3"><SpoolStatusBadge status={s.status} label={STATUS_LABELS[s.status] || s.status} /></Table.Cell>
                  <Table.Cell className="px-3"><div className="max-w-36">{where(e)}</div></Table.Cell>
                  <Table.Cell className="px-3">
                    <RemainingBar grams={e.remaining.toFixed(0)} pct={e.pct} color={barColor(e)} />
                  </Table.Cell>
                  <Table.Cell className="px-3">
                    <div className="flex justify-end">{rowMenu(s)}</div>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </TableCard.Root>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ s, e }) => (
            <Card
              key={s.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/spools/${s.id}`)}
              onKeyDown={(ev) => { if (ev.key === "Enter") navigate(`/spools/${s.id}`); }}
              className="flex cursor-pointer flex-col gap-4 p-4 transition duration-100 ease-linear hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <div className="flex items-start gap-3">
                <SpoolSwatch color={e.colorHex} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-md font-semibold text-primary">{e.title}</p>
                  <p className="mt-0.5 text-sm text-tertiary">{[e.colorName, e.colorHex].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <div onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>{rowMenu(s)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="sm" color="gray" type="pill-color">{e.material}</Badge>
                <SpoolStatusBadge status={s.status} label={STATUS_LABELS[s.status] || s.status} />
              </div>
              <div>{where(e, true)}</div>
              <RemainingBar grams={e.remaining.toFixed(0)} pct={e.pct} color={barColor(e)} className="mt-auto" />
            </Card>
          ))}
          {rows.length === 0 && <p className="text-sm text-tertiary">{t("Ничего не найдено")}</p>}
        </div>
      )}
    </div>
  );
}
