import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, AlertCircle, Plus, Trash01, XClose } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { Tab, TabList, TabPanel, Tabs } from "@/components/application/tabs/tabs";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { cx } from "@/utils/cx";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, dateLocale, tServer } from "../i18n.js";
import { GateCard } from "../components/HubGates.jsx";
import { PrinterArt, CapabilityChips } from "../components/PrinterArt.jsx";
import SpoolPicker from "../components/SpoolPicker.jsx";
import FeedChangeBanner from "../components/FeedChangeBanner.jsx";
import LightToggle from "../components/LightToggle.jsx";
import { Card, CardHeader, EmptyNote, PageHeader, SpoolSwatch } from "../components/ft/ui.jsx";
import { Notice, Stat, StateBadge, ZoneTitle } from "../components/ft/printer.jsx";
import { enrichSpool } from "../utils/spools.js";
import { HOLDER_INDEX, slotLabel } from "../utils/slots.js";
import { DEFAULTS, machineRate, resolveRates } from "../cost.js";

// Суммы без знака валюты: у тарифов принтера валюты нет, её выбирают в расчёте.
const round2 = (n) => (Math.round(n * 100) / 100).toString();

// Лейбл системы мультиподачи по возможностям: «Слоты ACE Pro» / «Слоты мультиподачи».
function mmuLabel(caps) {
  return caps?.mmu_name ? `${t("Слоты")} ${caps.mmu_name}` : t("Слоты мультиподачи");
}

// Режимы подачи филамента (см. app/services/feed_mode.py).
const FEED_MODES = ["auto", "mmu", "direct"];

export default function Printers() {
  const [printers, setPrinters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mrPrinter, setMrPrinter] = useState(null);
  const [costPrinter, setCostPrinter] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [presets, setPresets] = useState([]);
  const [searchParams] = useSearchParams();
  const emptyForm = {
    preset_key: "",
    name: "",
    brand: null,
    model: null,
    capabilities: null,
    note: null,
    integration_type: "manual",
    moonraker_url: "",
    moonraker_api_key: "",
    slot_count: 4,
    _autoName: "", // последнее имя, подставленное из пресета (чтобы отличить от ручного)
  };
  const [form, setForm] = useState(emptyForm);

  function load() {
    return api.get("/api/printers").then((ps) => { setPrinters(ps); return ps; }).catch(() => []);
  }
  useEffect(() => {
    api.get("/api/printers/presets").then(setPresets).catch(() => {});
    load().then((ps) => {
      const mrId = searchParams.get("moonraker");
      if (mrId) { const p = ps.find((x) => x.id === mrId); if (p) setMrPrinter(p); }
      // Ссылка с панели («катушка не назначена») ведёт прямо в слоты принтера.
      const slotsId = searchParams.get("slots");
      if (slotsId) { const p = ps.find((x) => x.id === slotsId); if (p) setSelected(p); }
    });
  }, []);

  function applyPreset(key) {
    const p = presets.find((x) => x.key === key);
    if (!p) { setForm((f) => ({ ...f, preset_key: "" })); return; }
    const auto = [p.brand, p.model].filter(Boolean).join(" ");
    setForm((f) => {
      // Обновляем автоимя при смене модели, но не трогаем имя, вписанное вручную.
      const userTyped = f.name && f.name !== f._autoName;
      return {
        ...f,
        preset_key: key,
        brand: p.brand,
        model: p.model,
        capabilities: p.capabilities,
        note: p.note,
        integration_type: p.integration_type,
        slot_count: p.capabilities?.mmu_slots ?? (p.capabilities?.has_mmu ? f.slot_count : 0),
        name: userTyped ? f.name : auto,
        _autoName: auto,
      };
    });
  }

  async function create(e) {
    e.preventDefault();
    await api.post("/api/printers", {
      name: form.name,
      preset_key: form.preset_key || null,
      brand: form.brand,
      model: form.model,
      capabilities: form.capabilities,
      integration_type: form.integration_type,
      moonraker_url: form.moonraker_url || null,
      moonraker_api_key: form.moonraker_api_key || null,
      slot_count: Number(form.slot_count) || 0,
    });
    setShowForm(false);
    setForm(emptyForm);
    load();
  }

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function remove(p) {
    if (!window.confirm(`${t("Удалить принтер")} «${p.name}»? ${t("Его слоты и история назначений будут удалены.")}`)) return;
    await api.del(`/api/printers/${p.id}`);
    if (selected?.id === p.id) setSelected(null);
    if (mrPrinter?.id === p.id) setMrPrinter(null);
    if (costPrinter?.id === p.id) setCostPrinter(null);
    load();
  }

  const presetItems = presets.map((p) => ({ id: p.key, label: [p.brand || t("Общие"), p.model].filter(Boolean).join(" · ") }));
  const integrationItems = [{ id: "manual", label: t("Ручной") }, { id: "moonraker", label: "Moonraker" }];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0 lg:mb-0"
        title={t("Принтеры")}
        badge={<Badge size="sm" color="brand" type="pill-color">{printers.length}</Badge>}
        actions={
          <Button size="md" color={showForm ? "secondary" : "primary"} iconLeading={showForm ? undefined : Plus} onClick={() => setShowForm(!showForm)}>
            {showForm ? t("Отмена") : t("Добавить")}
          </Button>
        }
      />

      {showForm && (
        <Card>
          <form onSubmit={create}>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <Select
                label={t("Модель принтера")}
                placeholder={t("— выбрать модель —")}
                items={presetItems}
                selectedKey={form.preset_key || null}
                onSelectionChange={(k) => applyPreset(String(k))}
              >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
              </Select>
              <Input label={t("Название")} value={form.name} onChange={set("name")} isRequired />

              {form.preset_key && (
                <div className="flex items-center gap-4 rounded-xl bg-secondary p-4 sm:col-span-2">
                  <PrinterArt caps={form.capabilities || {}} brand={form.brand} model={form.model} size={56} />
                  <div className="min-w-0">
                    {(form.brand || form.model) && <p className="text-sm font-semibold text-primary">{[form.brand, form.model].filter(Boolean).join(" ")}</p>}
                    <CapabilityChips caps={form.capabilities || {}} />
                    {form.note && (
                      <p className="mt-1.5 text-sm text-tertiary">
                        {form.note.split(" · ").map((seg) => t(seg)).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Select
                label={t("Тип интеграции")}
                items={integrationItems}
                selectedKey={form.integration_type}
                onSelectionChange={(k) => set("integration_type")(String(k))}
              >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
              </Select>
              <Input label={t("Количество слотов")} type="number" value={String(form.slot_count)} onChange={set("slot_count")} />
              {form.integration_type === "moonraker" && (
                <>
                  <Input label="Moonraker URL" value={form.moonraker_url} onChange={set("moonraker_url")} placeholder="http://192.168.1.50:7125" />
                  <Input label={t("API-ключ (если требуется)")} value={form.moonraker_api_key} onChange={set("moonraker_api_key")} placeholder={t("необязательно")} />
                </>
              )}
            </div>
            <div className="flex justify-end border-t border-secondary px-5 py-4">
              <Button type="submit" size="md">{t("Создать")}</Button>
            </div>
          </form>
        </Card>
      )}

      <TableCard.Root>
        <Table aria-label={t("Принтеры")} size="sm">
          <Table.Header>
            <Table.Head id="name" isRowHeader label={t("Название")} className="w-full" />
            <Table.Head id="model" label={t("Модель")} className="px-3" />
            <Table.Head id="integration" label={t("Интеграция")} className="px-3" />
            <Table.Head id="active" label={t("Активен")} className="px-3" />
            <Table.Head id="actions" className="px-3" />
          </Table.Header>
          <Table.Body items={printers} renderEmptyState={() => <EmptyNote>{t("Пока нет принтеров")}</EmptyNote>}>
            {(p) => (
              <Table.Row id={p.id}>
                <Table.Cell>
                  <div className="flex items-center gap-3">
                    <PrinterArt caps={p.capabilities || {}} brand={p.brand} model={p.model} size={36} />
                    <span className="text-sm font-medium text-primary">{p.name}</span>
                  </div>
                </Table.Cell>
                <Table.Cell className="px-3 whitespace-nowrap">{[p.brand, p.model].filter(Boolean).join(" ") || "—"}</Table.Cell>
                <Table.Cell className="px-3">
                  <Badge size="sm" color={p.integration_type === "moonraker" ? "brand" : "gray"} type="pill-color">{p.integration_type}</Badge>
                </Table.Cell>
                <Table.Cell className="px-3">
                  <BadgeWithDot size="sm" type="pill-color" color={p.is_active ? "success" : "gray"}>{p.is_active ? t("да") : t("нет")}</BadgeWithDot>
                </Table.Cell>
                <Table.Cell className="px-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" color="secondary" onClick={() => setSelected(p)}>{t("Слоты")}</Button>
                    {p.integration_type === "moonraker" && (
                      <Button size="sm" color="secondary" onClick={() => setMrPrinter(p)}>Moonraker</Button>
                    )}
                    <Button size="sm" color="secondary" onClick={() => setCostPrinter(p)}>{t("Себестоимость")}</Button>
                    <Dropdown.Root>
                      <Dropdown.DotsButton />
                      <Dropdown.Popover className="w-min">
                        <Dropdown.Menu onAction={(key) => key === "delete" && remove(p)}>
                          <Dropdown.Item id="delete" icon={Trash01}><span className="pr-4">{t("Удалить")}</span></Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </div>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </TableCard.Root>

      {selected && (
        <SlotsManager
          printer={selected}
          onClose={() => setSelected(null)}
          onPrinterChanged={(p) => {
            setSelected(p);
            setPrinters((prev) => prev.map((x) => (x.id === p.id ? p : x)));
            if (mrPrinter?.id === p.id) setMrPrinter(p);
          }}
        />
      )}
      {mrPrinter && (
        <MoonrakerPanel
          printer={mrPrinter}
          onClose={() => setMrPrinter(null)}
          onSaved={(p) => {
            setMrPrinter(p);
            setPrinters((prev) => prev.map((x) => (x.id === p.id ? p : x)));
            if (selected?.id === p.id) setSelected(p);
          }}
        />
      )}
      {costPrinter && (
        <CostParamsPanel
          printer={costPrinter}
          onClose={() => setCostPrinter(null)}
          onSaved={(p) => {
            setCostPrinter(p);
            setPrinters((prev) => prev.map((x) => (x.id === p.id ? p : x)));
          }}
        />
      )}
    </div>
  );
}

const closeBtn = (onClose) => <ButtonUtility size="sm" color="tertiary" icon={XClose} tooltip={t("Закрыть")} onClick={onClose} />;

// Во сколько обходится час работы этого принтера — единственное место, где
// задаются тарифы железа. Общих настроек у расчёта нет: пустое поле означает
// значение по умолчанию, и оно же стоит в подсказке.
//
// Валюты здесь нет намеренно. Она выбирается в самом расчёте, а числа не
// пересчитываются, поэтому подписать поля одной валютой значило бы соврать
// тем, кто считает в другой.
function CostParamsPanel({ printer, onClose, onSaved }) {
  const [draft, setDraft] = useState(printer.cost_params || {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setDraft(printer.cost_params || {});
    setErr(null);
  }, [printer.id]);

  const rate = machineRate(resolveRates(draft));

  const FIELDS = [
    {
      key: "printer_price", label: t("Цена принтера"),
      hint: t("Сколько принтер стоил вам целиком — с доставкой и налогами. Эта сумма размазывается по всем часам, которые он отработает за срок службы."),
    },
    {
      key: "extra_upfront", label: t("Апгрейды"),
      hint: t("Всё, что докупили к принтеру перед работой: корпус, сушилка, закалённое сопло, стол. Считается вместе с ценой принтера."),
    },
    {
      key: "maintenance_per_year", label: t("Обслуживание в год"),
      hint: t("Расходники и ремонт за год: сопла, ремни, трубка PTFE, плёнки на стол. Обычно около 10 % от цены принтера."),
    },
    {
      key: "life_years", label: t("Срок службы, лет"), step: "0.5",
      hint: t("Сколько лет вы рассчитываете на нём печатать. Бытовой принтер — 3–5 лет, у фермы меньше: он изнашивается быстрее."),
    },
    {
      key: "uptime_pct", label: t("Загрузка, %"), hint:
        t("Какую долю времени принтер реально печатает. 100 % — круглосуточно без пауз; 30 % — это уже 2600 часов в год, много для дома. Чем ниже загрузка, тем дороже час: те же вложения делятся на меньшее число часов."),
    },
    {
      key: "power_w", label: t("Мощность, Вт"),
      hint: t("Средняя мощность за печать, а не пиковая: на прогреве принтер берёт 300–350 Вт, дальше около 100. Обычно 150 Вт — хорошая оценка."),
    },
    {
      key: "electricity_per_kwh", label: t("Электричество за кВт·ч"),
      hint: t("Ваш тариф из квитанции. Из него и мощности получается цена электричества за час печати."),
    },
    {
      key: "buffer_factor", label: t("Запас, ×"), step: "0.1", hint:
        t("Множитель на непредвиденное: брак и перепечатки, внеплановый ремонт, подорожание. 1.3 значит «прибавить 30 % сверху»; 1 — считать без запаса."),
    },
    {
      key: "printer_per_hour", label: t("Своя ставка за час"),
      hint: t("Если вы уже знаете, во сколько обходится час, впишите его сюда — и расчёт по цене, сроку и загрузке применяться не будет."),
    },
  ];

  async function save() {
    setBusy(true); setErr(null);
    // Пустое поле уходит как null: так бэкенд поймёт «значение по умолчанию».
    const params = Object.fromEntries(
      FIELDS.map(({ key }) => [key, draft[key] === "" || draft[key] == null ? null : Number(draft[key])]),
    );
    try {
      onSaved(await api.patch(`/api/printers/${printer.id}`, { cost_params: params }));
    } catch (e) { setErr(tServer(e.message)); }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader
        title={`${t("Себестоимость")}: ${printer.name}`}
        description={t("Отсюда берётся стоимость машиночаса в расчёте стоимости печати. Пустое поле — значение по умолчанию, оно стоит в подсказке. Валюта выбирается в самом расчёте, здесь важно, чтобы все цифры были в одной.")}
        actions={closeBtn(onClose)}
      />
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {FIELDS.map(({ key, label, step, hint }) => (
          <Input
            key={key}
            label={label}
            type="number"
            tooltip={hint}
            value={String(draft[key] ?? "")}
            placeholder={String(DEFAULTS[key] ?? "—")}
            onChange={(v) => setDraft({ ...draft, [key]: v })}
          />
        ))}
      </div>
      <div className="mx-5 mb-5 rounded-lg bg-secondary px-4 py-3 text-sm text-secondary">
        {t("Час печати обходится в")}{" "}
        <b className="font-semibold text-primary tabular-nums">{round2(rate.total_per_hour)}</b>
        {" — "}
        {t("износ")}{" "}
        <b className="font-semibold text-primary tabular-nums">{round2(rate.capital_per_hour)}</b>
        {" + "}
        {t("электричество")}{" "}
        <b className="font-semibold text-primary tabular-nums">{round2(rate.electric_per_hour)}</b>
      </div>
      {err && <div className="px-5 pb-4"><Notice tone="error">{err}</Notice></div>}
      <div className="flex justify-end border-t border-secondary px-5 py-4">
        <Button size="md" onClick={save} isDisabled={busy}>{t("Сохранить")}</Button>
      </div>
    </Card>
  );
}

// Камера принтера: адрес кадра для уведомлений в Telegram и проверка «та ли
// это камера». Пустое поле — адрес определяется автоматически (у Moonraker
// спрашивается список камер, дальше пробуется типовой путь mjpg-streamer).
function CameraCard({ printer, onSaved }) {
  const [url, setUrl] = useState(printer.camera_url || "");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setUrl(printer.camera_url || "");
    setRes(null); setErr(null);
  }, [printer.id]);

  // Проверяем всегда сохранённый адрес — иначе кадр придёт не с той камеры,
  // которую потом снимет уведомление.
  async function checkCamera() {
    setBusy(true); setErr(null); setRes(null);
    try {
      const saved = await api.patch(`/api/printers/${printer.id}`, { camera_url: url.trim() });
      onSaved?.(saved);
      setRes(await api.post(`/api/printers/${printer.id}/camera/test`));
    } catch (e) { setErr(tServer(e.message)); }
    setBusy(false);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h4 className="m-0 text-md font-semibold text-primary">{t("Камера принтера")}</h4>
        <p className="mt-1 text-sm text-tertiary">
          {t("Кадр с камеры прикладывается к уведомлениям в Telegram (включается в настройках). Оставьте поле пустым — адрес определится сам.")}
        </p>
      </div>
      <Input label={t("Адрес снимка")} value={url} onChange={setUrl} placeholder="http://192.168.1.50/webcam/?action=snapshot" />
      <div>
        <Button size="md" color="secondary" onClick={checkCamera} isDisabled={busy} isLoading={busy}>
          {busy ? t("Проверяем…") : t("Сохранить и проверить")}
        </Button>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {res && (
        <div className="flex flex-col gap-3">
          <Notice tone={res.ok ? "success" : "error"}>
            {tServer(res.detail)}
            {res.ok && res.url && !printer.camera_url ? ` · ${res.url}` : ""}
          </Notice>
          {res.data_url && <img src={res.data_url} alt={t("Кадр с камеры")} className="block max-w-full rounded-lg ring-1 ring-secondary" />}
        </div>
      )}
    </div>
  );
}

function MoonrakerPanel({ printer, onClose, onSaved }) {
  const [conn, setConn] = useState(null);
  const [ov, setOv] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const navigate = useNavigate();

  async function consumeJob(jobId) {
    setError(null);
    try {
      const res = await api.post(`/api/printers/${printer.id}/moonraker-jobs/${encodeURIComponent(jobId)}/import`);
      navigate(`/print-jobs/${res.print_job_id}/consume`);
    } catch (e) { setError(e.message); }
  }

  async function testConn() {
    setError(null);
    try { setConn(await api.post(`/api/printers/${printer.id}/test-connection`)); }
    catch (e) { setError(e.message); }
  }
  async function loadOverview() {
    setError(null);
    try { setOv(await api.get(`/api/printers/${printer.id}/overview`)); }
    catch (e) { setError(e.message); }
  }
  async function loadJobs() {
    setError(null);
    try { setJobs(await api.get(`/api/printers/${printer.id}/moonraker-jobs?limit=20`)); }
    catch (e) { setError(e.message); }
  }

  // При открытии панели сразу подгружаем всё (в т.ч. из deep-link с главной).
  // Во время сушки часто перечитываем overview, чтобы подхватывать ручные
  // изменения температуры и времени с экрана принтера.
  useEffect(() => {
    loadOverview(); loadJobs();
    const visible = () => document.visibilityState === "visible";
    const fast = setInterval(() => {
      if (!visible()) return;
      if (ov?.dryer?.status === "drying") {
        loadOverview();
      } else {
        api.get(`/api/printers/${printer.id}/status`)
          .then((st) => setOv((prev) => (prev ? { ...prev, status: st } : prev)))
          .catch(() => {});
      }
    }, 7000);
    const slow = setInterval(() => {
      if (visible()) { loadOverview(); loadJobs(); }
    }, 60000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [printer.id, ov?.dryer?.status]);

  const st = ov?.status;
  const totals = ov?.totals;
  const sysinfo = ov?.system;
  const pct = (v) => (v != null ? Math.round(v * 100) + "%" : "—");
  const temp = (v, target) => `${v != null ? Math.round(v) + "°" : "—"}${target > 0 ? ` / ${Math.round(target)}°` : ""}`;
  const hasDryer = !!ov?.dryer;
  // Если вкладка «Сушка» пропала (хаб отключили), возвращаемся на «Слоты».
  const activeTab = tab === "dryer" && !hasDryer ? "overview" : tab;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-secondary px-5 py-4">
        <PrinterArt caps={ov?.capabilities || printer.capabilities || {}} brand={printer.brand} model={printer.model} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-md font-semibold text-primary">Moonraker — {printer.name}</h3>
          <p className="truncate text-sm text-tertiary">
            {[printer.brand, printer.model].filter(Boolean).join(" ")}
            {printer.moonraker_url && <span className="font-mono"> · {printer.moonraker_url}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LightToggle printerId={printer.id} light={ov?.light} onChanged={loadOverview} onError={setError} />
          <Button size="sm" color="secondary" onClick={testConn}>{t("Тест соединения")}</Button>
          <Button size="sm" color="secondary" onClick={() => { loadOverview(); loadJobs(); }}>{t("Обновить")}</Button>
          {closeBtn(onClose)}
        </div>
      </div>

      {(error || conn) && (
        <div className="flex flex-col gap-3 px-5 pt-4">
          {error && <Notice tone="error">{error}</Notice>}
          {conn && <Notice tone={conn.ok ? "success" : "error"}>{tServer(conn.detail)}</Notice>}
        </div>
      )}

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setTab(String(k))} className="w-full">
        <div className="px-5 pt-4">
          <TabList type="underline" size="md">
            <Tab id="overview" label={t("Слоты и телеметрия")} />
            {hasDryer && <Tab id="dryer" label={t("Сушка")} />}
            <Tab id="camera" label={t("Камера")} />
            <Tab id="jobs" label={t("Задания")} badge={jobs ? jobs.length : undefined} />
          </TabList>
        </div>

        <TabPanel id="overview" className="flex flex-col gap-6 p-5">
          {ov?.gates?.length > 0 && (
            <section>
              <ZoneTitle className="mb-1">{mmuLabel(ov?.capabilities)}</ZoneTitle>
              <p className="mb-3 text-sm text-tertiary">{t("— что принтер видит в слотах и совпадает ли это с привязанными катушками").replace(/^—\s*/, "")}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {ov.gates.map((g) => <GateCard key={g.gate} g={g} />)}
              </div>
            </section>
          )}

          {/* Мультиподача у принтера есть, но сейчас снята — вместо пустого места
              объясняем, почему нет слотов и сушилки. */}
          {ov?.capabilities?.mmu_off && (
            <Notice tone="info" title={t("Прямая подача")}>
              {ov.capabilities.mmu_name || t("Мультиподача")}{" "}
              {ov.capabilities.feed_mode_setting === "direct"
                ? t("отключена вручную — слоты и сушилка скрыты.")
                : t("не в работе: принтер сообщает, что хаб отключён, — печать идёт с одной катушки.")}{" "}
              {t("Режим переключается в «Слотах».")}
            </Notice>
          )}

          {st && (
            <section>
              <ZoneTitle>{t("Телеметрия")}</ZoneTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                <Stat label={t("Состояние:").replace(/:$/, "")}>{st.state || "—"}</Stat>
                <Stat label={t("Сопло:").replace(/:$/, "")}>{temp(st.nozzle_temp, st.nozzle_target)}</Stat>
                <Stat label={t("Стол:").replace(/:$/, "")}>{temp(st.bed_temp, st.bed_target)}</Stat>
                <Stat label={t("Обдув модели:").replace(/:$/, "")}>{pct(st.part_fan)}</Stat>
                <Stat label={t("Вент. корпуса:").replace(/:$/, "")}>{pct(st.box_fan)}</Stat>
                <Stat label={t("Фильтр воздуха:").replace(/:$/, "")}>{pct(st.air_filter_fan)}</Stat>
                <Stat label={t("Скорость:").replace(/:$/, "")}>{pct(st.speed_factor)}</Stat>
                <Stat label={t("Поток:").replace(/:$/, "")}>{pct(st.extrude_factor)}</Stat>
                {st.state === "printing" && <Stat label={t("Прогресс:").replace(/:$/, "")}>{pct(st.progress)}</Stat>}
              </div>
            </section>
          )}

          {totals && (
            <section>
              <ZoneTitle>{t("Статистика за всю жизнь принтера")}</ZoneTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t("печатей")}>{totals.total_jobs}</Stat>
                <Stat label={t("чистой печати")}>{Math.round((totals.total_print_time_sec || 0) / 3600)} {t("ч")}</Stat>
                <Stat label={t("филамента")}>{((totals.total_filament_mm || 0) / 1e6).toFixed(2)} {t("км")}</Stat>
                <Stat label={t("самая долгая")}>{((totals.longest_print_sec || 0) / 3600).toFixed(1)} {t("ч")}</Stat>
              </div>
            </section>
          )}

          {sysinfo && (sysinfo.cpu || sysinfo.os || sysinfo.moonraker_version) && (
            <p className="text-xs text-tertiary">
              {[
                sysinfo.os,
                sysinfo.cpu,
                sysinfo.klipper_version ? `Klipper ${sysinfo.klipper_version}` : null,
                sysinfo.moonraker_version && sysinfo.moonraker_version !== "?" ? `Moonraker ${sysinfo.moonraker_version}` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </TabPanel>

        {hasDryer && (
          <TabPanel id="dryer" className="p-5">
            <DryerCard printer={printer} dryer={ov.dryer} onChanged={loadOverview} />
          </TabPanel>
        )}

        <TabPanel id="camera" className="p-5">
          <CameraCard printer={printer} onSaved={onSaved} />
        </TabPanel>

        <TabPanel id="jobs" className="pb-1">
          {jobs ? (
            <Table aria-label={t("Задания")} size="sm">
              <Table.Header>
                <Table.Head id="file" isRowHeader label={t("Файл")} className="w-full" />
                <Table.Head id="status" label={t("Статус")} className="px-3" />
                <Table.Head id="g" label={t("Филамент, г")} className="px-3" />
                <Table.Head id="slicer" label={t("Слайсер")} className="px-3" />
                <Table.Head id="act" className="px-3" />
              </Table.Header>
              <Table.Body items={jobs.map((j) => ({ ...j, id: j.job_id }))} renderEmptyState={() => <EmptyNote>{t("Нет завершённых заданий")}</EmptyNote>}>
                {(j) => (
                  <Table.Row id={j.id}>
                    <Table.Cell><span className="font-mono text-sm text-primary">{(j.filename || "").split("/").pop()}</span></Table.Cell>
                    <Table.Cell className="px-3">
                      <BadgeWithDot size="sm" type="pill-color" color={j.status === "completed" ? "success" : j.status === "in_progress" ? "brand" : "error"}>{j.status}</BadgeWithDot>
                    </Table.Cell>
                    <Table.Cell className="px-3">
                      {j.filament_total_g != null ? Number(j.filament_total_g).toFixed(1) : (j.filament_used_mm != null ? Math.round(j.filament_used_mm) + " " + t("мм") : "—")}
                    </Table.Cell>
                    <Table.Cell className="px-3">{j.slicer || "—"}</Table.Cell>
                    <Table.Cell className="px-3">
                      <div className="flex justify-end">
                        {j.consumed ? (
                          <span title={j.consumed_via === "manual" ? t("Файл уже списан вручную") : t("Уже списано из Moonraker")}>
                            <Badge size="sm" color="success" type="pill-color">
                              {t("Списано")}{j.cost != null ? ` · ${fmtMoney(j.cost, j.cost_currency)}` : ""}
                            </Badge>
                          </span>
                        ) : j.status === "completed" ? (
                          <Button size="sm" color="secondary" onClick={() => consumeJob(j.job_id)}>{t("Списать")}</Button>
                        ) : j.filament_used_mm > 0 ? (
                          // Печать оборвана, но филамент израсходован — списываем по факту.
                          <span title={t("Печать прервана — спишется фактически израсходованная длина")}>
                            <Button size="sm" color="secondary" onClick={() => consumeJob(j.job_id)}>{t("Списать по факту")}</Button>
                          </span>
                        ) : null}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table>
          ) : (
            <EmptyNote>{t("Загрузка…")}</EmptyNote>
          )}
        </TabPanel>
      </Tabs>
    </Card>
  );
}

function fmtDryerRemaining(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const DRYER_PRESETS = [
  { material: "PLA", temp: 45, hours: 4 },
  { material: "PETG", temp: 60, hours: 4 },
  { material: "ABS", temp: 60, hours: 4 },
];

// Катушка, стоящая в слоте: цвет, название, материал и остаток — те же
// признаки, по которым её выбирают в списке.
function SlotSpool({ spool, fallback, profiles, locations }) {
  if (!spool) return <Badge size="sm" color="brand" type="pill-color">{fallback}</Badge>;
  const e = enrichSpool(spool, { profiles, locations });
  return (
    <div className="flex items-center gap-3">
      <SpoolSwatch color={e.colorHex} size="sm" className="rounded-full" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-primary">{e.title}</p>
        <p className="truncate text-sm text-tertiary">{[e.material, e.colorName].filter(Boolean).join(" · ")}</p>
      </div>
      <span className={cx("ml-auto text-sm font-medium tabular-nums", e.low ? "text-error-primary" : "text-secondary")}>
        {e.remaining.toFixed(0)}{" "}{t("г")}
      </span>
    </div>
  );
}

function SlotsManager({ printer, onClose, onPrinterChanged }) {
  const [slots, setSlots] = useState([]);
  const [spools, setSpools] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [occupied, setOccupied] = useState({}); // spool_id -> «Принтер / Slot 2»
  const [history, setHistory] = useState(null);
  const [caps, setCaps] = useState(printer.capabilities || {});
  const [feedState, setFeedState] = useState(printer.feed_state || null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get(`/api/printers/${printer.id}/slots`).then(setSlots).catch(() => {});
    loadOccupied();
  }
  // Занятость катушек по всем принтерам — чтобы в списке было видно, что
  // катушка уже стоит в другом слоте. Свой принтер подписан коротко (просто
  // слот), чужой — с именем принтера.
  async function loadOccupied() {
    const printers = await api.get("/api/printers").catch(() => []);
    const map = {};
    for (const p of printers) {
      const ss = await api.get(`/api/printers/${p.id}/slots`).catch(() => []);
      for (const s of ss) {
        if (!s.current_spool_id) continue;
        const slotName = slotLabel(s);
        map[s.current_spool_id] = p.id === printer.id ? slotName : `${p.name} / ${slotName}`;
      }
    }
    setOccupied(map);
  }
  useEffect(() => {
    load();
    setCaps(printer.capabilities || {});
    setFeedState(printer.feed_state || null);
    api.get("/api/spools").then(setSpools).catch(() => {});
    api.get("/api/filament-profiles").then(setProfiles).catch(() => {});
    api.get("/api/locations").then(setLocations).catch(() => {});
  }, [printer.id]);

  // Режим подачи: «авто» решает телеметрия хаба, остальные — фиксированные.
  const mode = FEED_MODES.includes(caps.feed_mode) ? caps.feed_mode : "auto";
  // Что получилось на деле: в «авто» это последнее наблюдение за железом
  // (feed_state с бэка), иначе — сам выбор. Слоты снятого хаба прячем: их
  // катушек в принтере физически нет, а привязки и история остаются.
  const resolved = mode === "auto" ? feedState?.mode || null : mode;
  const holder = slots.find((s) => s.slot_index === HOLDER_INDEX) || null;
  // В прямой подаче остаётся одна строка — внешняя катушка (у принтера без
  // хаба её роль играет слот 1). В мультиподаче держатель прячем: печать идёт
  // не с него, а катушка на нём может преспокойно стоять дальше.
  const feedSlot = holder || slots.find((s) => s.slot_index === 1) || null;
  const shownSlots = resolved === "direct"
    ? (feedSlot ? [feedSlot] : [])
    : slots.filter((s) => s.slot_index !== HOLDER_INDEX);
  const hubHidden = resolved === "direct" && slots.length > shownSlots.length;
  // Баннер подтверждения — тот же, что на панели: смену железа надо подтвердить
  // и отсюда, иначе автосписание так и останется на паузе.
  const feedChange = feedState && !feedState.confirmed
    ? {
        mode: resolved || feedState.mode,
        prev: feedState.prev,
        mmu_name: caps.mmu_name,
        slots: shownSlots.map((s) => ({
          id: s.id,
          slot_index: s.slot_index,
          name: slotLabel(s),
          spool: s.current_spool_id ? { id: s.current_spool_id } : null,
        })),
      }
    : null;

  async function onFeedConfirmed() {
    const updated = await api.get(`/api/printers/${printer.id}`).catch(() => null);
    if (updated) { setFeedState(updated.feed_state || null); onPrinterChanged?.(updated); }
    load();
  }
  async function setFeedMode(next) {
    setBusy(true);
    try {
      const updated = await api.post(`/api/printers/${printer.id}/feed-mode`, { mode: next });
      setCaps(updated.capabilities || {});
      setFeedState(updated.feed_state || null);
      onPrinterChanged?.(updated);
      load();
    } finally { setBusy(false); }
  }

  async function addSlot() {
    await api.post(`/api/printers/${printer.id}/slots`, {});
    load();
  }
  async function toggleSlot(slot) {
    await api.patch(`/api/slots/${slot.id}`, { is_active: !slot.is_active });
    load();
  }
  async function assign(slotId, spoolId) {
    if (!spoolId) return;
    await api.post(`/api/slots/${slotId}/assign-spool`, { spool_id: spoolId });
    load();
  }
  async function unassign(slotId) {
    await api.post(`/api/slots/${slotId}/unassign-spool`);
    load();
  }
  async function showHistory(slotId) {
    const h = await api.get(`/api/slots/${slotId}/history`);
    setHistory({ slotId, rows: h });
  }

  const spoolById = (id) => spools.find((x) => x.id === id) || null;
  const spoolLabel = (id) => {
    const s = spoolById(id);
    return s ? s.label || t("Без метки") : "";
  };

  const modeItems = [
    { id: "auto", label: t("Авто — по телеметрии принтера") },
    { id: "mmu", label: t("Мультиподача (хаб со слотами)") },
    { id: "direct", label: t("Прямая подача — одна катушка") },
  ];
  const modeNote =
    mode === "auto"
      ? t("Пока хаб отключён от принтера, приложение само держит прямую подачу и вернёт слоты, когда он снова окажется в работе.")
      : mode === "direct"
        ? holder
          ? t("Активна только внешняя катушка — та, что стоит на держателе; по ней же идёт автосписание. Слоты хаба выключены, их история сохранена.")
          : t("Активен только слот 1 — в него ставится катушка с держателя, по нему же идёт автосписание. Остальные слоты выключены, их история сохранена.")
        : t("Слоты хаба включены, даже если он сейчас молчит.");

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`${t("Слоты —")} ${printer.name}`}
        actions={
          <>
            <Button size="sm" color="secondary" iconLeading={Plus} onClick={addSlot}>{t("Слот")}</Button>
            {closeBtn(onClose)}
          </>
        }
      />

      <div className="flex flex-col gap-4 border-b border-secondary p-5">
        <div className="max-w-md">
          <Select
            label={t("Подача филамента")}
            items={modeItems}
            selectedKey={mode}
            isDisabled={busy}
            onSelectionChange={(k) => setFeedMode(String(k))}
            hint={modeNote}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
        </div>
        {feedChange && <FeedChangeBanner printer={printer} change={feedChange} onConfirmed={onFeedConfirmed} />}
        {hubHidden && (
          <Notice tone="warning">{t("Слоты хаба скрыты — он сейчас не подключён. Катушки остались привязанными, история цела.")}</Notice>
        )}
      </div>

      <Table aria-label={t("Слоты")} size="sm">
        <Table.Header>
          <Table.Head id="slot" isRowHeader label={t("Слот")} />
          <Table.Head id="cur" label={t("Текущая катушка")} className="px-3 min-w-56" />
          <Table.Head id="assign" label={t("Назначить")} className="px-3 min-w-56" />
          <Table.Head id="act" className="px-3" />
        </Table.Header>
        <Table.Body items={shownSlots} renderEmptyState={() => <EmptyNote>{t("Нет слотов")}</EmptyNote>}>
          {(s) => (
            <Table.Row id={s.id} className={s.is_active ? undefined : "opacity-60"}>
              <Table.Cell>
                <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                  {slotLabel(s)}
                  {!s.is_active && <Badge size="sm" color="gray" type="pill-color">{t("выключен")}</Badge>}
                </span>
              </Table.Cell>
              <Table.Cell className="px-3">
                {s.current_spool_id
                  ? <SlotSpool spool={spoolById(s.current_spool_id)} fallback={s.current_spool_label} profiles={profiles} locations={locations} />
                  : <span className="text-tertiary">{t("пусто")}</span>}
              </Table.Cell>
              <Table.Cell className="px-3">
                {s.is_active ? (
                  <SpoolPicker
                    spools={spools}
                    profiles={profiles}
                    locations={locations}
                    occupied={occupied}
                    onSelect={(spoolId) => assign(s.id, spoolId)}
                  />
                ) : (
                  <span className="text-tertiary">{t("слот не используется")}</span>
                )}
              </Table.Cell>
              <Table.Cell className="px-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {s.current_spool_id && <Button size="sm" color="secondary" onClick={() => unassign(s.id)}>{t("Снять")}</Button>}
                  <Button size="sm" color="secondary" onClick={() => toggleSlot(s)}>{s.is_active ? t("Отключить слот") : t("Включить слот")}</Button>
                  <Button size="sm" color="tertiary" onClick={() => showHistory(s.id)}>{t("История")}</Button>
                </div>
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table>

      {history && (
        <div className="border-t border-secondary">
          <div className="px-5 pt-4 pb-2 text-sm font-semibold text-primary">{t("История назначений")}</div>
          <Table aria-label={t("История назначений")} size="sm">
            <Table.Header>
              <Table.Head id="sp" isRowHeader label={t("Катушка")} />
              <Table.Head id="from" label={t("Назначена")} className="px-3" />
              <Table.Head id="to" label={t("Снята")} className="px-3" />
            </Table.Header>
            <Table.Body items={history.rows} renderEmptyState={() => <EmptyNote>{t("Пусто")}</EmptyNote>}>
              {(r) => (
                <Table.Row id={r.id}>
                  <Table.Cell><span className="text-sm text-primary">{spoolLabel(r.spool_id)}</span></Table.Cell>
                  <Table.Cell className="px-3">{new Date(r.assigned_at).toLocaleString(dateLocale())}</Table.Cell>
                  <Table.Cell className="px-3">
                    {r.unassigned_at
                      ? new Date(r.unassigned_at).toLocaleString(dateLocale())
                      : <Badge size="sm" color="brand" type="pill-color">{t("сейчас")}</Badge>}
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      )}
    </Card>
  );
}

function DryerCard({ printer, dryer, onChanged }) {
  const [temp, setTemp] = useState(45);
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [remainingSec, setRemainingSec] = useState(null);
  const drying = dryer.status === "drying";

  useEffect(() => {
    if (!drying) return;
    if (dryer?.target_temp > 0) setTemp(dryer.target_temp);
    if (dryer?.remaining_min > 0) {
      setHours(Math.max(0.5, Math.round((dryer.remaining_min / 60) * 2) / 2));
    } else if (dryer?.duration_min > 0) {
      setHours(Math.max(0.5, Math.round((dryer.duration_min / 60) * 2) / 2));
    }
  }, [drying, dryer?.target_temp, dryer?.remaining_min, dryer?.duration_min]);

  useEffect(() => {
    if (!drying || !dryer?.remaining_min) {
      setRemainingSec(null);
      return undefined;
    }
    setRemainingSec(Math.max(0, Math.round(dryer.remaining_min * 60)));
    const timer = setInterval(() => {
      setRemainingSec((v) => (v == null ? v : Math.max(0, v - 1)));
    }, 1000);
    return () => clearInterval(timer);
  }, [drying, dryer?.remaining_min]);

  async function send(action, preset = null) {
    setErr(null); setBusy(true);
    const nextTemp = preset?.temp ?? Number(temp);
    const nextHours = preset?.hours ?? Number(hours);
    if (preset) {
      setTemp(preset.temp);
      setHours(preset.hours);
    }
    try {
      await api.post(`/api/printers/${printer.id}/dryer`, {
        action,
        temp_c: Number(nextTemp) || null,
        duration_min: Math.round((Number(nextHours) || 0) * 60) || null,
        unit: dryer?.unit ?? null,
      });
      // ACE применяет команду асинхронно — даём пару секунд перед обновлением
      await new Promise((r) => setTimeout(r, 2500));
      onChanged();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const remainingLabel = remainingSec != null ? fmtDryerRemaining(remainingSec) : null;
  const durationLabel = dryer?.duration_min > 0 ? fmtDryerRemaining(dryer.duration_min * 60) : null;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="m-0 text-md font-semibold text-primary">{t("Сушка филамента")}</h4>
          {drying ? (
            <BadgeWithDot size="sm" type="pill-color" color="brand">
              {t("сушит")} {dryer.target_temp}°C{remainingLabel ? ` · ${t("осталось")} ${remainingLabel}` : durationLabel ? ` · ${t("Длительность")} ${durationLabel}` : ""}
            </BadgeWithDot>
          ) : dryer.status === "heater_err" ? (
            <BadgeWithDot size="sm" type="pill-color" color="error">{t("ошибка нагревателя")}</BadgeWithDot>
          ) : (
            <BadgeWithDot size="sm" type="pill-color" color="gray">{t("выключена")}</BadgeWithDot>
          )}
        </div>
        {dryer.humidity > 0 && <span className="text-sm text-tertiary">{t("Влажность")}: <b className="font-semibold text-secondary">{dryer.humidity}%</b></span>}
      </div>

      <div>
        <ZoneTitle>{t("Профили сушки")}</ZoneTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {DRYER_PRESETS.map((preset) => (
            <button
              key={preset.material}
              type="button"
              disabled={busy || drying}
              onClick={() => send("start", preset)}
              title={drying ? t("Выключите текущую сушку перед запуском профиля") : `${preset.material}: ${preset.temp}°C · ${preset.hours} ${t("ч")}`}
              className="flex cursor-pointer flex-col items-start gap-2 rounded-xl bg-primary p-4 text-left ring-1 ring-secondary transition duration-100 ease-linear ring-inset hover:bg-primary_hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-md font-semibold text-primary">{preset.material}</span>
              <span className="flex gap-2">
                <Badge size="sm" color="gray" type="pill-color">{preset.temp}°C</Badge>
                <Badge size="sm" color="gray" type="pill-color">{preset.hours} {t("ч")}</Badge>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Input label={t("Температура, °C")} type="number" value={String(temp)} onChange={setTemp} isDisabled={drying} className="w-36" />
        <Input label={t("Время, ч")} type="number" value={String(hours)} onChange={setHours} isDisabled={drying} className="w-32" />
        {drying
          ? <Button size="md" color="primary-destructive" isDisabled={busy} onClick={() => send("stop")}>{t("Выключить")}</Button>
          : <Button size="md" isDisabled={busy} onClick={() => send("start")}>{t("Включить сушку")}</Button>}
      </div>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}
