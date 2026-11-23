import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Link as AriaLink } from "react-aria-components";
import { Check, Copy01, Download01, Droplets02, Edit01, MarkerPin01, Plus, Printer, Tag01 } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { Tab, TabList, TabPanel, Tabs } from "@/components/application/tabs/tabs";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Card, CardHeader, EmptyNote, PageHeader, SpecGroup, SpecRow, SpoolStatusBadge, SpoolSwatch } from "../components/ft/ui.jsx";
import { Notice, Stat } from "../components/ft/printer.jsx";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { SPEC_GROUPS, fmtSpec } from "../specFields.js";
import { spoolTitle } from "../utils/spools.js";
import { t, dateLocale, tReason } from "../i18n.js";
import { slotLabel } from "../utils/slots.js";
import { locationPath } from "../utils/locations.js";

const STATUS_RU = {
  new: t("Новая"), in_use: t("Используется"), almost_empty: t("Заканчивается"),
  empty: t("Закончилась"), archived: t("Архив"),
};
const EVENT_RU = {
  created: t("Создана"), manual_adjustment: t("Корректировка"), weighed: t("Взвешивание"),
  print_usage: t("Печать"), moved: t("Перемещение"), archived: t("Архив"),
  dried: t("Сушка"),
};
// Select не принимает пустую строку в роли id, поэтому «не выбрано» — условный ключ.
const NONE = "__none";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", year: "2-digit" });
}
function lengthM(grams, density, dmm) {
  if (!grams) return 0;
  const r = (Number(dmm) || 1.75) / 2 / 10; // cm
  const area = Math.PI * r * r; // cm²
  return Number(grams) / (Number(density) || 1.24) / area / 100; // m
}

// Катушка и есть шкала остатка.
//
// Нарисованная катушка на глазах пустеет: длина намотки равна остатку, а цвет
// намотки — цвет самого филамента. Один объект отвечает сразу на «что это» и
// «сколько осталось». Цвет дуги всегда цвет филамента: тревога о низком остатке
// живёт в значке статуса рядом с названием, а не в цвете дуги — длина и цвет
// несут разные факты и не должны драться за один канал.
function SpoolGauge({ pct, color, size = 160 }) {
  const R = 54, BAND = 15, C = 2 * Math.PI * R;
  const p = Math.max(0, Math.min(1, pct));
  const wound = p * C;
  const fill = color || "var(--color-bg-quaternary)";
  // Засечка в конце намотки: у белого и натурального филамента дуга почти
  // сливается с пустой дорожкой, и без неё не видно, где намотка кончается.
  const endAngle = ((-90 + p * 360) * Math.PI) / 180;
  const tick = (k) => [70 + k * Math.cos(endAngle), 70 + k * Math.sin(endAngle)];
  const [tx1, ty1] = tick(R - BAND / 2);
  const [tx2, ty2] = tick(R + BAND / 2);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={`${t("Остаток")} ${Math.round(p * 100)}%`}>
        {/* пустая часть катушки */}
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth={BAND} className="stroke-bg-quaternary" />
        {/* намотка: дуга = остаток, цвет = филамент */}
        <circle cx="70" cy="70" r={R} fill="none" stroke={fill} strokeWidth={BAND}
          strokeDasharray={`${wound} ${C - wound}`} transform="rotate(-90 70 70)" />
        {/* тонкие кромки намотки */}
        <circle cx="70" cy="70" r={R + BAND / 2} fill="none" strokeWidth="1" className="stroke-border-secondary" />
        <circle cx="70" cy="70" r={R - BAND / 2} fill="none" strokeWidth="1" className="stroke-border-secondary" />
        {p > 0.002 && p < 0.998 && (
          <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} strokeWidth="1.5" className="stroke-fg-quaternary" />
        )}
        {/* ступица */}
        <circle cx="70" cy="70" r={R - BAND / 2 - 1} className="fill-bg-primary" />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-display-xs font-semibold text-primary tabular-nums">{Math.round(p * 100)}%</span>
        <span className="text-xs text-tertiary">{t("остаток")}</span>
      </div>
    </div>
  );
}

/** Крупное число с подписью и пояснением под ним. */
function BigNumber({ label, value, hint }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-tertiary">{label}</p>
      <p className="mt-1 text-display-xs font-semibold text-primary tabular-nums sm:text-display-sm">{value}</p>
      <p className="mt-0.5 text-sm text-tertiary">{hint}</p>
    </div>
  );
}

/** Поле с кнопкой «OK» в одну строку: взвесить или указать остаток. */
function WeightField({ label, value, onChange, onSubmit }) {
  return (
    <div className="flex items-end gap-2">
      <Input size="sm" type="number" label={label} value={value} onChange={onChange} className="flex-1" />
      <Button size="md" color="secondary" onClick={onSubmit} isDisabled={!value}>OK</Button>
    </div>
  );
}

export default function SpoolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [spool, setSpool] = useState(null);
  const [events, setEvents] = useState([]);
  const [card, setCard] = useState(null);
  const [placement, setPlacement] = useState(null);
  const [error, setError] = useState(null);
  const [weighInput, setWeighInput] = useState("");
  const [adjustInput, setAdjustInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("overview");

  function load() {
    api.get(`/api/spools/${id}`).then(setSpool).catch(() => {});
    api.get(`/api/spools/${id}/events`).then(setEvents).catch(() => {});
    api.get(`/api/spools/${id}/card`).then(setCard).catch(() => {});
    api.get(`/api/spools/${id}/placement`).then(setPlacement).catch(() => {});
  }
  useEffect(() => { load(); }, [id]);

  if (!spool) return <div className="py-16 text-center text-sm text-tertiary">{t("Загрузка…")}</div>;

  const remaining = Number(spool.current_weight_g);
  const capacity = Number(spool.initial_filament_weight_g) || 1000;
  const pct = Math.max(0, Math.min(1, remaining / capacity));
  const density = spool.specs?.density || card?.density_g_cm3;
  const dia = spool.diameter_mm || card?.diameter_mm || 1.75;
  const lenLeft = lengthM(remaining, density, dia);
  const lenTotal = lengthM(capacity, density, dia);
  const prints = Math.round(remaining / 50);

  const title = spoolTitle(spool.manufacturer || card?.brand, card?.name || spool.label);
  const material = spool.material || card?.material;
  const colorName = spool.color_name || card?.color_name;
  const colorHex = spool.color_hex || card?.color_hex;
  const nozzle = spool.hotend_temp ? `${spool.hotend_temp}°C` : (card?.nozzle_temp || "—");
  const bed = spool.bed_temp ? `${spool.bed_temp}°C` : (card?.bed_temp || "—");
  const fan = spool.fan_speed != null ? `${spool.fan_speed}%` : (card?.fan_percent != null ? `${card.fan_percent}%` : "—");
  const flow = spool.flow_rate != null ? `${Number(spool.flow_rate)}%` : "—";
  const pa = spool.specs?.pressure_advance != null ? String(spool.specs.pressure_advance) : "—";

  async function weigh() {
    setError(null);
    try { await api.post(`/api/spools/${id}/weigh`, { total_weight_g: Number(weighInput) }); setWeighInput(""); load(); }
    catch (e) { setError(e.message); }
  }
  async function adjust() {
    setError(null);
    try { await api.post(`/api/spools/${id}/adjust`, { new_weight_g: Number(adjustInput) }); setAdjustInput(""); load(); }
    catch (e) { setError(e.message); }
  }
  function copyProfile() {
    const text = `Nozzle ${nozzle}, Bed ${bed}, Fan ${fan}, Flow ${flow}`;
    navigator.clipboard?.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const locName = placement?.slot
    ? `${placement.slot.printer_name} / ${placement.slot.slot_name || "Slot " + placement.slot.slot_index}`
    : placement?.location_name;

  // Бренд, материал и цвет уже стоят в названии — в подзаголовке только то,
  // чего в названии нет: цвет и код, артикул, где катушка лежит.
  const subtitle = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {(colorName || colorHex) && (
        <span>
          {colorName || t("Цвет")}
          {colorHex && <span className="ml-1.5 font-mono text-quaternary">{colorHex}</span>}
        </span>
      )}
      {material && <span>{material}</span>}
      {(spool.sku || spool.label) && (
        <span className="inline-flex items-center gap-1"><Tag01 className="size-4" aria-hidden="true" /> {spool.sku || spool.label}</span>
      )}
      {locName && (
        <span className="inline-flex items-center gap-1"><MarkerPin01 className="size-4" aria-hidden="true" /> {locName}</span>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("Катушки"), href: "/spools" }, { label: title }]}
        leading={spool.photo
          ? <img src={spool.photo} alt="" className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-secondary" />
          : <SpoolSwatch color={colorHex} size="lg" />}
        title={title}
        badge={<SpoolStatusBadge status={spool.status} label={STATUS_RU[spool.status] || spool.status} />}
        subtitle={subtitle}
        actions={
          <>
            <Button size="md" color="secondary" iconLeading={Edit01} onClick={() => navigate(`/spools/${id}/edit`)}>{t("Редактировать")}</Button>
            <Button size="md" iconLeading={Plus} onClick={() => navigate("/gcode")}>{t("Учесть печать")}</Button>
          </>
        }
      />
      {error && <Notice tone="error" className="mb-6" onClose={() => setError(null)}>{error}</Notice>}

      {/* Остаток — то, ради чего страницу и открывают */}
      <Card className="mb-6 flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-6">
        <div className="flex justify-center sm:block"><SpoolGauge pct={pct} color={colorHex} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="grid grid-cols-3 gap-4">
            <BigNumber label={t("Осталось")} value={remaining.toFixed(0)} hint={`${t("из")} ${capacity.toFixed(0)} ${t("г")}`} />
            <BigNumber label={t("Длина")} value={lenLeft.toFixed(0)} hint={`${t("из")} ${lenTotal.toFixed(0)} ${t("м")}`} />
            <BigNumber label={t("Хватит на")} value={prints} hint={t("печатей по 50 г")} />
          </div>
          <div className="grid grid-cols-1 gap-4 border-t border-secondary pt-5 lg:grid-cols-2">
            <WeightField label={t("Взвесить (общий вес с катушкой), г")} value={weighInput} onChange={setWeighInput} onSubmit={weigh} />
            <WeightField label={t("Указать остаток вручную, г")} value={adjustInput} onChange={setAdjustInput} onSubmit={adjust} />
          </div>
        </div>
      </Card>

      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="w-full">
        {/* На телефоне четыре вкладки не помещаются в ширину: список прокручивается вбок,
            а подчёркивание тянется на всю его длину. */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <TabList type="underline" size="md" className="w-max min-w-full">
            <Tab id="overview" label={t("Обзор")} />
            <Tab id="specs" label={t("Характеристики")} />
            <Tab id="history" label={t("История")} badge={events.length || undefined} />
            <Tab id="notes" label={t("Заметки")} />
          </TabList>
        </div>

        <TabPanel id="overview" className="pt-6">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader
                  title={t("Профиль печати")}
                  actions={
                    <Button size="sm" color="secondary" iconLeading={copied ? Check : Copy01} onClick={copyProfile}>
                      {copied ? t("Скопировано") : t("Копировать")}
                    </Button>
                  }
                />
                <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
                  <Stat label={t("Сопло")}>{nozzle}</Stat>
                  <Stat label={t("Стол")}>{bed}</Stat>
                  <Stat label={t("Обдув")}>{fan}</Stat>
                  <Stat label="Flow">{flow}</Stat>
                  <Stat label="Pressure Adv">{pa}</Stat>
                </div>
              </Card>
              <PlacementCard spool={spool} placement={placement} onChange={load} onError={setError} />
            </div>
            <div className="flex flex-col gap-6">
              <DryingCard spool={spool} events={events} onDone={load} />
              <LabelCard id={id} card={card} onError={setError} />
            </div>
          </div>
        </TabPanel>

        <TabPanel id="specs" className="pt-6">
          <Card>
            <div className="grid grid-cols-1 gap-x-10 gap-y-8 p-5 sm:grid-cols-2 xl:grid-cols-3">
              <SpecGroup title={t("Катушка")}>
                <SpecRow label={t("Вес нетто")}>{capacity.toFixed(0)} {t("г")}</SpecRow>
                <SpecRow label={t("Диаметр")}>{Number(dia)} {t("мм")}</SpecRow>
                <SpecRow label={t("Пустая катушка")}>{spool.empty_spool_weight_g != null ? `${Number(spool.empty_spool_weight_g).toFixed(0)} ${t("г")}` : "—"}</SpecRow>
                <SpecRow label={t("Куплена")}>{fmtDate(spool.purchase_date)}{spool.price != null ? ` · ${Number(spool.price)} ${spool.currency}` : ""}</SpecRow>
              </SpecGroup>
              {SPEC_GROUPS.map((g) => {
                const items = g.fields
                  .map((f) => ({ f, v: fmtSpec(f, spool.specs?.[f.key]) }))
                  .filter((x) => x.v != null);
                if (!items.length) return null;
                return (
                  <SpecGroup key={g.title} title={g.title}>
                    {items.map(({ f, v }) => (
                      <SpecRow key={f.key} label={f.label}>
                        {f.key.endsWith("_url")
                          ? <AriaLink href={v} target="_blank" rel="noreferrer" className="cursor-pointer rounded-sm text-brand-secondary outline-focus-ring hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">{t("ссылка ↗")}</AriaLink>
                          : v}
                      </SpecRow>
                    ))}
                  </SpecGroup>
                );
              })}
            </div>
          </Card>
        </TabPanel>

        <TabPanel id="history" className="pt-6">
          <TableCard.Root>
            <Table size="sm" aria-label={t("История использования")}>
              <Table.Header>
                <Table.Head id="date" isRowHeader label={t("Дата")} />
                <Table.Head id="event" label={t("Событие")} className="w-full" />
                <Table.Head id="delta" label={t("Объём")} />
              </Table.Header>
              <Table.Body items={events} renderEmptyState={() => <EmptyNote>{t("Пока нет событий")}</EmptyNote>}>
                {(ev) => (
                  <Table.Row id={ev.id}>
                    <Table.Cell className="whitespace-nowrap">{fmtDate(ev.created_at)}</Table.Cell>
                    <Table.Cell>{tReason(ev.reason) || EVENT_RU[ev.event_type] || ev.event_type}</Table.Cell>
                    <Table.Cell
                      className={cx(
                        "font-medium whitespace-nowrap tabular-nums",
                        ev.delta_g < 0 ? "text-error-primary" : ev.delta_g > 0 ? "text-success-primary" : "text-primary",
                      )}
                    >
                      {ev.delta_g != null ? `${ev.delta_g > 0 ? "+" : ""}${Number(ev.delta_g).toFixed(0)} ${t("г")}` : "—"}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          </TableCard.Root>
        </TabPanel>

        <TabPanel id="notes" className="pt-6">
          <Card className="p-5">
            {spool.notes
              ? <p className="m-0 text-md whitespace-pre-wrap text-secondary">{spool.notes}</p>
              : <p className="m-0 text-sm text-tertiary">{t("Заметок нет.")}</p>}
          </Card>
        </TabPanel>
      </Tabs>
    </div>
  );
}

/** Где лежит катушка: место хранения и слот принтера. */
function PlacementCard({ spool, placement, onChange, onError }) {
  const [locations, setLocations] = useState([]);
  const [slots, setSlots] = useState([]);

  useEffect(() => {
    api.get("/api/locations").then(setLocations).catch(() => {});
    (async () => {
      const printers = await api.get("/api/printers").catch(() => []);
      const all = [];
      for (const p of printers) {
        const ss = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
        const detached = p.feed_state?.mode === "direct";
        for (const s of ss) all.push({ id: s.id, label: `${p.name} / ${slotLabel(s, { detached })}` });
      }
      setSlots(all);
    })();
  }, []);

  async function setLocation(locationId) {
    try { await api.post(`/api/spools/${spool.id}/move`, { location_id: locationId || null }); onChange(); } catch (e) { onError(e.message); }
  }
  async function assignSlot(slotId) {
    if (!slotId) return;
    try { await api.post(`/api/slots/${slotId}/assign-spool`, { spool_id: spool.id }); onChange(); } catch (e) { onError(e.message); }
  }
  async function unassignSlot() {
    if (!placement?.slot) return;
    try { await api.post(`/api/slots/${placement.slot.slot_id}/unassign-spool`); onChange(); } catch (e) { onError(e.message); }
  }

  const locItems = [{ id: NONE, label: t("— не указано —") }, ...locations.map((l) => ({ id: l.id, label: locationPath(locations, l.id) }))];
  const slotItems = [{ id: NONE, label: t("— не в принтере —") }, ...slots];
  const slotKey = placement?.slot?.slot_id || NONE;

  return (
    <Card>
      <CardHeader title={t("Размещение")} />
      <div className="flex flex-col gap-4 p-5">
        <Select size="sm" label={t("Место хранения")} items={locItems} selectedKey={spool.location_id || NONE}
          onSelectionChange={(k) => setLocation(k === NONE ? null : String(k))}>
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
        <div className="flex flex-col gap-2">
          <Select size="sm" label={t("В принтере (слот)")} items={slotItems} selectedKey={slotKey}
            onSelectionChange={(k) => (k === NONE ? unassignSlot() : assignSlot(String(k)))}>
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
          {placement?.slot && (
            <div><Button size="sm" color="secondary" onClick={unassignSlot}>{t("Снять со слота")}</Button></div>
          )}
        </div>
      </div>
    </Card>
  );
}

function DryingCard({ spool, events, onDone }) {
  const lastDried = events.find((e) => e.event_type === "dried");
  const specs = spool.specs || {};
  const [temp, setTemp] = useState(String(specs.drying_temp || 50));
  const [hours, setHours] = useState(String(specs.dry_time_hours || 4));
  const [busy, setBusy] = useState(false);

  async function markDried() {
    setBusy(true);
    try {
      await api.post(`/api/spools/${spool.id}/dry`, { temp_c: Number(temp) || null, hours: Number(hours) || null });
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader
        title={t("Сушка филамента")}
        description={`${t("Последняя сушка:")} ${lastDried ? fmtDate(lastDried.created_at) : t("не сушилась")}`}
      />
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-4">
          <Input size="sm" type="number" label={t("Температура, °C")} value={temp} onChange={setTemp} />
          <Input size="sm" type="number" label={t("Время, ч")} value={hours} onChange={setHours} />
        </div>
        <Button size="md" color="secondary" iconLeading={Droplets02} isDisabled={busy} onClick={markDried}>{t("Просушена")}</Button>
      </div>
    </Card>
  );
}

/** QR-код катушки и печать этикетки с живым предпросмотром. */
function LabelCard({ id, card, onError }) {
  const [labelOpts, setLabelOpts] = useState(null);
  const [size, setSize] = useState("classic");
  const [fieldSlots, setFieldSlots] = useState(["nozzle_temp", "bed_temp", "pressure_advance", "flow_info"]);
  const [showLabel, setShowLabel] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    api.get("/api/spools/label-options")
      .then((o) => { setLabelOpts(o); if (o.default_fields) setFieldSlots(o.default_fields); })
      .catch(() => {});
  }, []);

  const fieldsQuery = () => fieldSlots.filter((f) => f && f !== "none").join(",");

  // Живой предпросмотр этикетки: перегенерируем картинку при смене размера/полей.
  useEffect(() => {
    if (!showLabel) return;
    let active = true;
    const fields = fieldSlots.filter((f) => f && f !== "none").join(",");
    const timer = setTimeout(async () => {
      try {
        const u = await api.blobUrl(`/api/spools/${id}/label.png?size=${size}&fields=${fields}`);
        if (active) setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return u; });
        else URL.revokeObjectURL(u);
      } catch { /* игнорируем */ }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [showLabel, size, fieldSlots, id]);

  function downloadLabel() {
    api.download(`/api/spools/${id}/label.pdf?size=${size}&fields=${fieldsQuery()}`, { filename: `spool-${size}.pdf` }).catch((e) => onError(e.message));
  }
  async function viewLabel() {
    try { window.open(await api.blobUrl(`/api/spools/${id}/label.pdf?size=${size}&fields=${fieldsQuery()}`), "_blank"); } catch (e) { onError(e.message); }
  }

  // Названия полей приходят с сервера, но это подписи интерфейса, а не данные
  // пользователя — прогоняем через словарь.
  const fieldItems = (labelOpts?.fields || []).map((f) => ({ id: f.key || "none", label: f.label ? t(f.label) : t("— нет —") }));

  return (
    <Card>
      <CardHeader title={t("QR и этикетка")} />
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-center gap-4">
          {card?.qr_png_base64 && (
            <img src={card.qr_png_base64} alt="QR" width={96} height={96} className="size-24 shrink-0 rounded-lg bg-white p-1 ring-1 ring-secondary" />
          )}
          <div className="flex min-w-0 flex-col items-start gap-3">
            <p className="m-0 text-sm text-tertiary">{t("Отсканируйте, чтобы открыть карточку с телефона.")}</p>
            <Button size="sm" color="secondary" iconLeading={Printer} onClick={() => setShowLabel(!showLabel)}>{t("Печать этикетки")}</Button>
          </div>
        </div>

        {showLabel && (
          <div className="flex flex-col gap-4 border-t border-secondary pt-5">
            <div className="grid grid-cols-2 gap-2">
              {(labelOpts?.sizes || []).map((s) => (
                <Button key={s.key} size="sm" color={size === s.key ? "primary" : "secondary"} onClick={() => setSize(s.key)}>
                  {s.key} · {s.width_mm}×{s.height_mm} {t("мм")}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {fieldSlots.map((val, i) => (
                <Select key={i} size="sm" label={`${t("Поле")} ${i + 1}`} items={fieldItems} selectedKey={val || "none"}
                  onSelectionChange={(k) => { const n = [...fieldSlots]; n[i] = String(k); setFieldSlots(n); }}>
                  {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                </Select>
              ))}
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-secondary">{t("Предпросмотр (как на печати)")}</p>
              {previewUrl
                ? <img alt={t("Предпросмотр этикетки")} src={previewUrl} className="block w-full rounded-lg bg-white ring-1 ring-secondary" />
                : <div className="rounded-lg border border-dashed border-primary p-5 text-center text-sm text-tertiary">{t("Генерирую…")}</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" color="secondary" onClick={viewLabel}>{t("Открыть крупно")}</Button>
              <Button size="sm" iconLeading={Download01} onClick={downloadLabel}>{t("Скачать PDF")}</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
