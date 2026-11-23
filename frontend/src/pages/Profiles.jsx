import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button as AriaButton } from "react-aria-components";
import { ChevronRight, Copy01, Edit01, Plus, SearchLg, Trash01, Upload01 } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { Tab, TabList, TabPanel, Tabs } from "@/components/application/tabs/tabs";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Input } from "@/components/base/input/input";
import { Card, EmptyNote, PageHeader, SpoolSwatch } from "../components/ft/ui.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { useAuth } from "../api/auth.jsx";
import { t } from "../i18n.js";

const colorCell = (p) => (
  <span className="inline-flex items-center gap-2">
    <SpoolSwatch color={p.color_hex || "#666"} size="sm" />
    <span className="text-sm text-secondary">{p.color_name || "—"}</span>
  </span>
);

export default function Profiles() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("mine"); // mine | catalog
  const [profiles, setProfiles] = useState([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState(null);
  const fileRef = useRef();

  // Каталог SpoolmanDB: бренды A→Я + лениво подгружаемые филаменты по бренду.
  const [brands, setBrands] = useState([]);
  const [open, setOpen] = useState({});        // brand -> bool
  const [byBrand, setByBrand] = useState({});   // brand -> entries[]

  function load() {
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
  }
  useEffect(load, []);
  useEffect(() => {
    if (tab === "catalog" && brands.length === 0) {
      api.get("/api/filament-catalog/brands").then(setBrands).catch(() => {});
    }
  }, [tab]);

  async function toggleBrand(brand) {
    setOpen((o) => ({ ...o, [brand]: !o[brand] }));
    if (!byBrand[brand]) {
      const rows = await api.get(`/api/filament-catalog/search?brand=${encodeURIComponent(brand)}&limit=500`).catch(() => []);
      setByBrand((m) => ({ ...m, [brand]: rows }));
    }
  }

  async function importSlicer(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    try {
      const created = await api.postFile("/api/filament-profiles/import-slicer", file);
      navigate(`/profiles/${created.id}/edit`);
    } catch (err) { setMsg(t("Не удалось импортировать: ") + err.message); }
    e.target.value = "";
  }

  async function duplicate(id, newColor) {
    const copy = await api.post(`/api/filament-profiles/${id}/duplicate${newColor ? "?new_color=true" : ""}`);
    navigate(`/profiles/${copy.id}/edit`);
  }
  async function remove(id) {
    await api.del(`/api/filament-profiles/${id}`);
    load();
  }

  const rows = profiles.filter((p) => {
    if (p.owner_user_id !== user?.id) return false;
    if (!q) return true;
    return `${p.brand} ${p.name} ${p.material} ${p.color_name}`.toLowerCase().includes(q.toLowerCase());
  });

  const brandRows = q ? brands.filter((b) => b.brand.toLowerCase().includes(q.toLowerCase())) : brands;
  const temps = (p) => {
    const noz = p.nozzle_temp_max ? `${p.nozzle_temp_min && p.nozzle_temp_min !== p.nozzle_temp_max ? p.nozzle_temp_min + "–" : ""}${p.nozzle_temp_max}°` : "—";
    const bed = p.bed_temp_max ? `${p.bed_temp_min && p.bed_temp_min !== p.bed_temp_max ? p.bed_temp_min + "–" : ""}${p.bed_temp_max}°` : "—";
    return `${noz} / ${bed}`;
  };

  return (
    <div>
      <PageHeader
        title={t("Профили филамента")}
        subtitle={t("Свои настройки печати на каждый бренд/материал/цвет.")}
        actions={tab === "mine" && (
          <>
            <Button size="md" color="secondary" iconLeading={Upload01} onClick={() => fileRef.current?.click()}>
              {t("Импорт из слайсера (JSON)")}
            </Button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importSlicer} />
            <Button size="md" iconLeading={Plus} onClick={() => navigate("/profiles/new")}>{t("Добавить")}</Button>
          </>
        )}
      />
      {msg && <Notice tone="error" className="mb-6" onClose={() => setMsg(null)}>{msg}</Notice>}

      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="w-full">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <TabList type="button-border" size="sm" aria-label={t("Профили филамента")}>
            <Tab id="mine" label={t("Мои профили")} />
            <Tab id="catalog" label={t("Каталог SpoolmanDB")} />
          </TabList>
          <Input
            size="sm"
            icon={SearchLg}
            placeholder={tab === "mine" ? t("Поиск по бренду, материалу, цвету…") : t("Поиск по бренду…")}
            value={q}
            onChange={setQ}
            className="w-full sm:ml-auto sm:w-80"
          />
        </div>

        <TabPanel id="mine">
          <TableCard.Root>
            <Table size="sm" aria-label={t("Мои профили")} onRowAction={(key) => navigate(`/profiles/${key}/edit`)}>
              <Table.Header>
                <Table.Head id="brand" isRowHeader label={t("Бренд")} />
                <Table.Head id="name" label={t("Название")} className="w-full" />
                <Table.Head id="material" label={t("Материал")} className="px-3" />
                <Table.Head id="color" label={t("Цвет")} className="px-3" />
                <Table.Head id="temps" label={t("Сопло / Стол")} className="px-3" />
                <Table.Head id="actions" className="px-3" />
              </Table.Header>
              <Table.Body items={rows} renderEmptyState={() => <EmptyNote>{t("Ничего не найдено")}</EmptyNote>}>
                {(p) => (
                  <Table.Row id={p.id}>
                    <Table.Cell className="whitespace-nowrap">{p.brand || "—"}</Table.Cell>
                    <Table.Cell><span className="font-medium text-primary">{p.name}</span></Table.Cell>
                    <Table.Cell className="px-3"><Badge size="sm" color="gray" type="pill-color">{p.material}</Badge></Table.Cell>
                    <Table.Cell className="px-3 whitespace-nowrap">{colorCell(p)}</Table.Cell>
                    <Table.Cell className="px-3 whitespace-nowrap tabular-nums">{temps(p)}</Table.Cell>
                    <Table.Cell className="px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => navigate(`/spools/new?profile=${p.id}`)}>
                          {t("В Мои катушки")}
                        </Button>
                        <ButtonUtility size="sm" color="tertiary" icon={Edit01} tooltip={t("Изменить")} onClick={() => navigate(`/profiles/${p.id}/edit`)} />
                        <ButtonUtility size="sm" color="tertiary" icon={Copy01} tooltip={t("Дублировать (новый цвет)")} onClick={() => duplicate(p.id, true)} />
                        <ButtonUtility size="sm" color="tertiary" icon={Trash01} tooltip={t("Удалить")} onClick={() => remove(p.id)} />
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </TableCard.Root>
        </TabPanel>

        <TabPanel id="catalog">
          <Card className="overflow-hidden">
            {brandRows.map((b) => {
              const isOpen = !!open[b.brand];
              const entries = byBrand[b.brand];
              return (
                <div key={b.brand} className="border-b border-secondary last:border-b-0">
                  <AriaButton
                    onPress={() => toggleBrand(b.brand)}
                    aria-expanded={isOpen}
                    className="flex w-full cursor-pointer items-center gap-3 bg-transparent px-5 py-3 text-left outline-focus-ring hover:bg-primary_hover focus-visible:outline-2 focus-visible:-outline-offset-2"
                  >
                    <ChevronRight className={cx("size-4 shrink-0 text-fg-quaternary transition duration-100 ease-linear", isOpen && "rotate-90")} aria-hidden="true" />
                    <span className="text-sm font-semibold text-primary">{b.brand}</span>
                    <Badge size="sm" color="gray" type="pill-color">{b.count}</Badge>
                  </AriaButton>
                  {isOpen && (
                    <div className="border-t border-secondary">
                      {(entries || []).map((p) => (
                        <div key={p.catalog_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-secondary px-5 py-2.5 pl-12 last:border-b-0">
                          <span className="min-w-40 flex-1 text-sm font-medium text-primary">{p.name}</span>
                          <Badge size="sm" color="gray" type="pill-color">{p.material}</Badge>
                          <span className="w-40">{colorCell(p)}</span>
                          <span className="min-w-28 text-sm whitespace-nowrap text-tertiary tabular-nums">{temps(p)}</span>
                          <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => navigate("/spools/new", { state: { catalog: p } })}>
                            {t("В Мои катушки")}
                          </Button>
                        </div>
                      ))}
                      {entries && entries.length === 0 && <p className="px-5 py-3.5 pl-12 text-sm text-tertiary">{t("Нет данных")}</p>}
                    </div>
                  )}
                </div>
              );
            })}
            {brands.length === 0 && <EmptyNote>{t("Загрузка…")}</EmptyNote>}
            {brands.length > 0 && brandRows.length === 0 && <EmptyNote>{t("Ничего не найдено")}</EmptyNote>}
          </Card>
        </TabPanel>
      </Tabs>
    </div>
  );
}
