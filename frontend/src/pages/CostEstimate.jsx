import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Copy01, Plus, Trash01 } from "@untitledui/icons";
import { Table, TableCard } from "@/components/application/table/table";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Card, CardHeader, EmptyNote, PageHeader } from "../components/ft/ui.jsx";
import { NONE, Pick } from "../components/ft/form.jsx";
import { Notice } from "../components/ft/printer.jsx";
import { api } from "../api/client.js";
import { compute, machineRate, resolveRates, DEFAULTS, DEFAULT_MARGINS, PRINTER_KEYS } from "../cost.js";
import { CURRENCIES, currencySign, fmtMoney } from "../format.js";
import { dateLocale, t } from "../i18n.js";

// Сколько строк показываем в списках по умолчанию — как в исходной таблице.
const HARDWARE_ROWS = 3;
const PACKAGING_ROWS = 3;

const emptyRow = () => ({ name: "", qty: "", unit_cost: "" });
const rows = (n) => Array.from({ length: n }, emptyRow);

// Значения формы держим строками (идиома SpoolForm/ProfileForm): пустое поле
// должно оставаться пустым, а не превращаться в 0 под курсором.
const str = (v) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

// Новый расчёт. Цифры, которые повторяются от изделия к изделию (цена филамента,
// ставка труда, расход, наценки), берём из последнего сохранённого расчёта:
// общих настроек у калькулятора нет, а вводить своё «в час» каждый раз заново —
// то ещё удовольствие. Расчётов ещё нет — остаются значения по умолчанию.
function blankForm(last) {
  const r = last?.inputs?.rates || {};
  return {
    part_name: "",
    revision: "",
    material: "",
    date: new Date().toISOString().slice(0, 10),
    qty: "1",
    filament_price_per_kg: str(last?.inputs?.filament_price_per_kg ?? DEFAULTS.filament_price_per_kg),
    filament_g: "",
    print_time_h: "",
    labor_min: "",
    labor_per_hour: str(r.labor_per_hour ?? DEFAULTS.labor_per_hour),
    material_efficiency: str(r.material_efficiency ?? DEFAULTS.material_efficiency),
    hardware: rows(HARDWARE_ROWS),
    packaging: [...rows(PACKAGING_ROWS), { name: t("Доставка"), qty: "1", unit_cost: "" }],
    margins: (last?.inputs?.margins ?? DEFAULT_MARGINS).map(str),
    notes: "",
  };
}

// Форма → inputs для cost.js и для сервера. Формат один и тот же: в этом же
// виде расчёт и хранится (см. backend/app/models/cost_estimate.py).
function toInputs(form, rates, currency) {
  const cleanRows = (list) =>
    (list || [])
      .filter((r) => (r.name || "").trim() || r.qty !== "" || r.unit_cost !== "")
      .map((r) => ({ name: r.name || "", qty: numOrNull(r.qty), unit_cost: numOrNull(r.unit_cost) }));
  return {
    part_name: form.part_name,
    material: form.material,
    date: form.date,
    qty: numOrNull(form.qty) ?? 1,
    filament_price_per_kg: numOrNull(form.filament_price_per_kg),
    filament_g: numOrNull(form.filament_g),
    print_time_h: numOrNull(form.print_time_h),
    labor_min: numOrNull(form.labor_min),
    hardware: cleanRows(form.hardware),
    packaging: cleanRows(form.packaging),
    margins: form.margins.map(numOrNull).filter((m) => m != null),
    currency,
    rates,
  };
}

// Сохранённый расчёт → форма. Пустые строки шаблона дорисовываем, чтобы было
// куда вписать новую позицию, не нажимая «+».
function fromInputs(inputs) {
  const padded = (list, min) => {
    const out = (list || []).map((r) => ({
      name: r.name || "",
      qty: str(r.qty),
      unit_cost: str(r.unit_cost),
    }));
    while (out.length < min) out.push(emptyRow());
    return out;
  };
  return {
    part_name: inputs.part_name || "",
    revision: "",
    material: inputs.material || "",
    date: inputs.date || "",
    qty: str(inputs.qty ?? 1),
    filament_price_per_kg: str(inputs.filament_price_per_kg),
    filament_g: str(inputs.filament_g),
    print_time_h: str(inputs.print_time_h),
    labor_min: str(inputs.labor_min),
    labor_per_hour: str(inputs.rates?.labor_per_hour ?? DEFAULTS.labor_per_hour),
    material_efficiency: str(inputs.rates?.material_efficiency ?? DEFAULTS.material_efficiency),
    hardware: padded(inputs.hardware, HARDWARE_ROWS),
    packaging: padded(inputs.packaging, PACKAGING_ROWS),
    margins: (inputs.margins?.length ? inputs.margins : DEFAULT_MARGINS).map(str),
    notes: "",
  };
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(dateLocale());
  } catch {
    return "—";
  }
}

// Сетка строки списка: на телефоне название на всю ширину, ниже кол-во, цена и
// сумма; от sm — всё в одну линию под общей шапкой.
const ITEM_COLS =
  "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_80px_104px_88px_36px]";

// Строка списка «кол-во × цена»: комплектующие и упаковка устроены одинаково.
function ItemRows({ items, onChange, currency, addLabel }) {
  const setRow = (i, patch) =>
    onChange(items.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-4">
      {/* Подписи колонок — только на широком экране; на телефоне подписано каждое поле */}
      <div className={`${ITEM_COLS} hidden text-sm font-medium text-secondary sm:grid`}>
        <span>{t("Название")}</span>
        <span>{t("Кол-во")}</span>
        <span>{t("Цена за штуку")}</span>
        <span>{t("Сумма")}</span>
        <span />
      </div>
      {items.map((row, i) => (
        <div key={i} className={`grid ${ITEM_COLS} items-end`}>
          <Input
            size="sm"
            label={t("Название")}
            value={row.name}
            placeholder={t("например, винт M3×12")}
            onChange={(v) => setRow(i, { name: v })}
            className="col-span-2 sm:col-span-1 sm:**:data-label:hidden"
          />
          <Input
            size="sm"
            type="number"
            min="0"
            step="any"
            label={t("Кол-во")}
            value={row.qty}
            onChange={(v) => setRow(i, { qty: v })}
            className="sm:**:data-label:hidden"
          />
          <Input
            size="sm"
            type="number"
            min="0"
            step="any"
            label={t("Цена за штуку")}
            value={row.unit_cost}
            onChange={(v) => setRow(i, { unit_cost: v })}
            className="sm:**:data-label:hidden"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-secondary sm:hidden">{t("Сумма")}</span>
            <span className="flex h-9 items-center text-sm font-medium whitespace-nowrap text-primary tabular-nums">
              {fmtMoney(Number(row.qty || 0) * Number(row.unit_cost || 0), currency)}
            </span>
          </div>
          <div className="col-start-3 row-start-1 self-end sm:col-start-auto sm:row-start-auto">
            <ButtonUtility
              size="sm"
              color="tertiary"
              icon={Trash01}
              tooltip={t("Убрать строку")}
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            />
          </div>
        </div>
      ))}
      <div>
        <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => onChange([...items, emptyRow()])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** Строка разбивки себестоимости: что это и сколько. */
function CostLine({ label, hint, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="m-0 text-sm font-medium text-primary">{label}</p>
        <p className="m-0 text-sm text-tertiary">{hint}</p>
      </div>
      <p className="m-0 text-sm font-semibold whitespace-nowrap text-primary tabular-nums">{value}</p>
    </div>
  );
}

export default function CostEstimate() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState(() => blankForm(null));
  const [printers, setPrinters] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [saved, setSaved] = useState([]);
  const [printerId, setPrinterId] = useState("");
  const [jobId, setJobId] = useState("");
  // Валюта расчёта. У сохранённого — своя: расчёты в разных валютах спокойно
  // живут рядом, и подпись сохранённого меняться не должна.
  const [currency, setCurrency] = useState("RUB");
  // Тарифы железа на момент сохранения. Заморожены: принтеру потом могли
  // поменять параметры, а отправленная заказчику цена меняться не должна.
  const [frozenRates, setFrozenRates] = useState(null);
  const [priceFromJob, setPriceFromJob] = useState(null); // {partial} — цена выведена из печати
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    api.get("/api/printers").then(setPrinters).catch(() => {});
    api.get("/api/print-jobs").then((list) => setJobs(list.slice(0, 50))).catch(() => {});
  }, []);

  function loadSaved() {
    api.get("/api/cost-estimates").then(setSaved).catch(() => {});
  }
  useEffect(() => {
    // Список нужен не только для таблицы: из последнего расчёта берутся
    // повторяющиеся цифры для нового (см. blankForm).
    api.get("/api/cost-estimates").then((list) => {
      setSaved(list);
      if (!id && list.length) {
        api.get(`/api/cost-estimates/${list[0].id}`)
          .then((last) => {
            setForm((prev) => (prev.part_name || prev.filament_g ? prev : blankForm(last)));
            setCurrency(last.currency || "RUB");
          })
          .catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Открытие сохранённого расчёта.
  useEffect(() => {
    if (!id) {
      setFrozenRates(null);
      setPriceFromJob(null);
      return;
    }
    api.get(`/api/cost-estimates/${id}`).then((est) => {
      const next = fromInputs(est.inputs || {});
      next.revision = est.revision || "";
      next.notes = est.notes || "";
      setForm(next);
      setPrinterId(est.printer_id || "");
      setJobId(est.print_job_id || "");
      setCurrency(est.currency || "RUB");
      setFrozenRates(est.inputs?.rates || null);
      setPriceFromJob(null);
      setError(null);
    }).catch((e) => setError(e.message));
  }, [id]);

  const printer = printers.find((p) => p.id === printerId) || null;
  // Подписи денежных полей идут за валютой расчёта (%s — как в tServer).
  const label = (s) => t(s).replace("%s", currencySign(currency));

  // Тарифы железа: у сохранённого расчёта замороженные, иначе — от принтера
  // (а без принтера — значения по умолчанию).
  const printerRates = useMemo(() => resolveRates(printer?.cost_params), [printer]);
  // Ставка труда и расход филамента правятся прямо в форме и всегда живые:
  // это про работу, а не про машину, и замораживать их незачем.
  const rates = useMemo(() => ({
    ...(frozenRates || printerRates),
    labor_per_hour: numOrNull(form.labor_per_hour) ?? DEFAULTS.labor_per_hour,
    material_efficiency: numOrNull(form.material_efficiency) ?? DEFAULTS.material_efficiency,
  }), [frozenRates, printerRates, form.labor_per_hour, form.material_efficiency]);
  const totals = useMemo(() => compute(toInputs(form, rates, currency)), [form, rates, currency]);

  // Принтеру поменяли параметры после сохранения — расчёт считает по старым.
  const stale = useMemo(() => {
    if (!frozenRates) return false;
    return PRINTER_KEYS.some((k) => Number(frozenRates[k]) !== Number(printerRates[k]));
  }, [frozenRates, printerRates]);

  function pickJob(nextId) {
    setJobId(nextId);
    const job = jobs.find((j) => j.id === nextId);
    if (!job) return;
    const grams = job.consumed_g ?? (job.total_filament_used_g != null ? Number(job.total_filament_used_g) : null);
    const patch = {};
    if (grams != null) patch.filament_g = String(Number(grams).toFixed(1));
    if (job.estimated_print_time_sec) patch.print_time_h = (job.estimated_print_time_sec / 3600).toFixed(2);
    if (!form.part_name && job.file_name) patch.part_name = job.file_name.replace(/\.[^.]+$/, "");
    // У печати известна фактическая себестоимость по ценам катушек. Кладём её
    // не суммой, а ценой за кг — в то же поле: иначе из расчёта выпал бы
    // коэффициент расхода и тираж, и правка граммов ничего бы не меняла.
    if (job.cost != null && grams) {
      patch.filament_price_per_kg = ((job.cost / grams) * 1000).toFixed(2);
      setPriceFromJob({ partial: !!job.cost_partial });
    } else {
      setPriceFromJob(null);
    }
    set(patch);
    if (job.printer_id) setPrinterId(job.printer_id);
  }

  function refreshRates() {
    setFrozenRates(null); // дальше берутся текущие; сохранение их и запишет
  }

  async function save({ asNew = false } = {}) {
    setBusy(true); setError(null);
    const body = {
      name: form.part_name.trim() || t("Без названия"),
      revision: form.revision || null,
      notes: form.notes || null,
      printer_id: printerId || null,
      print_job_id: jobId || null,
      currency,
      inputs: toInputs(form, rates, currency),
    };
    try {
      if (id && !asNew) {
        const est = await api.patch(`/api/cost-estimates/${id}`, body);
        setFrozenRates(est.inputs?.rates || null);
      } else {
        const est = await api.post("/api/cost-estimates", body);
        navigate(`/cost/${est.id}`, { replace: true });
      }
      loadSaved();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function remove() {
    if (!id) return;
    if (!window.confirm(t("Удалить этот расчёт?"))) return;
    try {
      await api.del(`/api/cost-estimates/${id}`);
      loadSaved();
      navigate("/cost");
    } catch (e) { setError(e.message); }
  }

  const rate = machineRate(rates);

  const jobItems = [
    { id: NONE, label: t("— заполнить вручную —") },
    ...jobs.map((j) => ({
      id: j.id,
      label: `${(j.file_name || t("без файла")).split("/").pop()} · ${fmtDate(j.completed_at || j.created_at)}${j.consumed_g != null ? ` · ${j.consumed_g.toFixed(0)} ${t("г")}` : ""}`,
    })),
  ];
  const printerItems = [{ id: NONE, label: t("— общие настройки —") }, ...printers.map((p) => ({ id: p.id, label: p.name }))];
  const currencyItems = CURRENCIES.map((c) => ({ id: c, label: `${c} ${currencySign(c)}` }));

  return (
    <div>
      <PageHeader
        title={t("Расчёт стоимости печати")}
        subtitle={t("Полная себестоимость изделия: филамент, электричество, износ принтера, ваше время и упаковка — и цена, которая оставляет нужную наценку.")}
        actions={
          <>
            {id && (
              <>
                <Button size="md" color="secondary" iconLeading={Plus} onClick={() => navigate("/cost")}>{t("Новый расчёт")}</Button>
                <Dropdown.Root>
                  <Dropdown.DotsButton />
                  <Dropdown.Popover className="w-min">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === "new") save({ asNew: true });
                        else if (key === "delete") remove();
                      }}
                    >
                      <Dropdown.Item id="new" icon={Copy01}><span className="pr-4">{t("Сохранить как новый")}</span></Dropdown.Item>
                      <Dropdown.Separator />
                      <Dropdown.Item id="delete" icon={Trash01}><span className="pr-4">{t("Удалить")}</span></Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown.Root>
              </>
            )}
            <Button size="md" isLoading={busy} onClick={() => save()}>
              {id ? t("Сохранить") : t("Сохранить расчёт")}
            </Button>
          </>
        }
      />

      {error && <Notice tone="error" className="mb-6" onClose={() => setError(null)}>{error}</Notice>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Слева — что вводим */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title={t("Исходные данные")} />
            <div className="flex flex-col gap-5 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Pick
                  label={t("Взять из печати")}
                  value={jobId || NONE}
                  onChange={(k) => pickJob(k === NONE ? "" : k)}
                  items={jobItems}
                />
                <Pick
                  label={t("Принтер")}
                  tooltip={t("Чьи тарифы пойдут в стоимость машиночаса. Задаются на странице «Принтеры» → «Себестоимость». Без принтера берутся значения по умолчанию.")}
                  value={printerId || NONE}
                  onChange={(k) => setPrinterId(k === NONE ? "" : k)}
                  items={printerItems}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input size="sm" label={t("Название изделия")} value={form.part_name} onChange={(v) => set({ part_name: v })} />
                <Input size="sm" label={t("Версия")} value={form.revision} placeholder="V1" onChange={(v) => set({ revision: v })} />
                <Input size="sm" type="date" label={t("Дата")} value={form.date} onChange={(v) => set({ date: v })} />
                <Input size="sm" label={t("Материал")} value={form.material} placeholder="PETG" onChange={(v) => set({ material: v })} />
                <Pick label={t("Валюта")} value={currency} onChange={setCurrency} items={currencyItems} />
              </div>
              {/* Курса у приложения нет, и заводить его ради подписи не стоит:
                  валюта здесь говорит, в чём заданы числа, а не пересчитывает их. */}
              <p className="m-0 -mt-2 text-sm text-tertiary">
                {t("Смена валюты не пересчитывает числа — она только подписывает суммы. Все цифры, включая параметры принтера, должны быть в одной валюте.")}
              </p>

              <div className="grid grid-cols-1 gap-4 border-t border-secondary pt-5 sm:grid-cols-2">
                <Input
                  size="sm" type="number" min="0" step="any"
                  label={label("Цена филамента, %s/кг")}
                  tooltip={t("Во сколько вам обошёлся килограмм этого пластика. Если взять данные из готовой печати, цена подставится по фактически списанным катушкам.")}
                  value={form.filament_price_per_kg}
                  onChange={(v) => { set({ filament_price_per_kg: v }); setPriceFromJob(null); }}
                />
                <Input
                  size="sm" type="number" min="0" step="any"
                  label={t("Филамента на изделие, г")}
                  value={form.filament_g}
                  onChange={(v) => set({ filament_g: v })}
                />
                <Input
                  size="sm" type="number" min="0" step="any"
                  label={t("Время печати, ч")}
                  tooltip={t("Сколько принтер печатает всю партию. Из этих часов и тарифов принтера получается стоимость машиночаса — износ плюс электричество.")}
                  value={form.print_time_h}
                  onChange={(v) => set({ print_time_h: v })}
                />
                <Input
                  size="sm" type="number" min="0" step="any"
                  label={t("Работа руками, мин")}
                  tooltip={t("Ваше время на всю партию: снять со стола, убрать поддержки, зашкурить, собрать, упаковать. Время печати сюда не входит — принтер работает сам.")}
                  value={form.labor_min}
                  onChange={(v) => set({ labor_min: v })}
                />
                <Input
                  size="sm" type="number" min="0" step="any"
                  label={label("Ставка труда, %s/ч")}
                  tooltip={t("Во сколько вы оцениваете свой час работы. Умножается на «работу руками» — на время печати не влияет.")}
                  value={form.labor_per_hour}
                  onChange={(v) => set({ labor_per_hour: v })}
                />
                <Input
                  size="sm" type="number" min="1" step="0.05"
                  label={t("Расход филамента, ×")}
                  tooltip={t("Насколько пластика уходит больше, чем весит сама деталь: юбка, поддержки, продувка при смене цвета, неудачные попытки. 1.1 значит «прибавить 10 %»; 1 — считать ровно по весу детали.")}
                  value={form.material_efficiency}
                  onChange={(v) => set({ material_efficiency: v })}
                />
                <Input
                  size="sm" type="number" min="1" step="1"
                  label={t("Штук в партии")}
                  tooltip={t("Сколько изделий печатается за раз. Умножается только филамент: время печати и работа руками задаются сразу на всю партию.")}
                  value={form.qty}
                  onChange={(v) => set({ qty: v })}
                />
              </div>
              {priceFromJob && (
                <p className="m-0 -mt-2 text-sm text-tertiary">
                  {t("Цена филамента посчитана по фактически списанным катушкам.")}
                  {priceFromJob.partial && ` ${t("(часть катушек без цены — итог занижен)")}`}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title={t("Комплектующие")}
              description={t("Всё, что входит в изделие кроме филамента: крепёж, магниты, вставки, электроника.")}
            />
            <div className="p-5">
              <ItemRows
                items={form.hardware}
                onChange={(hardware) => set({ hardware })}
                currency={currency}
                addLabel={t("Добавить комплектующее")}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title={t("Упаковка и доставка")}
              description={t("Коробка, плёнка, скотч, вкладыш — и почтовые расходы, если доставка за ваш счёт.")}
            />
            <div className="p-5">
              <ItemRows
                items={form.packaging}
                onChange={(packaging) => set({ packaging })}
                currency={currency}
                addLabel={t("Добавить упаковку")}
              />
            </div>
          </Card>

          <Card className="p-5">
            <Input size="sm" label={t("Заметки")} value={form.notes} onChange={(v) => set({ notes: v })} />
          </Card>
        </div>

        {/* Справа — что получилось; при прокрутке остаётся на виду */}
        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card>
            <CardHeader
              title={t("Себестоимость")}
              description={`${t("Час печати обходится в")} ${fmtMoney(rate.total_per_hour, currency)}${printer ? ` · ${printer.name}` : ""}`}
            />
            <div className="p-5">
              <p className="m-0 text-sm font-medium text-tertiary">{t("Полная себестоимость")}</p>
              <p className="m-0 mt-1 text-display-md font-semibold tracking-tight text-primary tabular-nums">{fmtMoney(totals.landed_total, currency)}</p>
              <p className="m-0 mt-0.5 text-sm text-tertiary">{t("за всю партию")}</p>
              <div className="mt-4 divide-y divide-secondary border-t border-secondary">
                <CostLine label={t("Материалы")} hint={t("филамент и комплектующие")} value={fmtMoney(totals.materials_total, currency)} />
                <CostLine
                  label={t("Работа руками")}
                  hint={`${fmtMoney(rates.labor_per_hour, currency)} ${t("в час")}`}
                  value={fmtMoney(totals.labor_total, currency)}
                />
                <CostLine label={t("Принтер")} hint={t("износ и электричество")} value={fmtMoney(totals.machine_total, currency)} />
                <CostLine label={t("Упаковка")} hint={t("и доставка")} value={fmtMoney(totals.packaging_total, currency)} />
              </div>
            </div>
          </Card>

          {stale && (
            <Notice
              tone="warning"
              actions={<Button size="sm" color="secondary" onClick={refreshRates}>{t("Пересчитать по тарифам принтера")}</Button>}
            >
              {t("Расчёт считается по параметрам принтера на момент сохранения — с тех пор их поменяли.")}
            </Notice>
          )}

          <Card>
            <CardHeader
              title={t("Цена по наценке")}
              description={t("Наценка считается от цены продажи: при 60 % себестоимость составляет 40 % от неё.")}
            />
            <div className="grid grid-cols-2 gap-4 p-5">
              {form.margins.map((m, i) => (
                <div key={i}>
                  <Input
                    size="sm" type="number" min="0" max="99" step="any"
                    label={t("Наценка, %")}
                    tooltip={i === 0 ? t("Доля цены продажи, которая остаётся вам сверх себестоимости. При 60 % себестоимость составляет 40 % цены, то есть цена = себестоимость ÷ 0,4. Это не «накрутка сверху»: наценка 100 % невозможна.") : undefined}
                    value={m}
                    onChange={(v) => set({ margins: form.margins.map((x, idx) => (idx === i ? v : x)) })}
                  />
                  <p className="m-0 mt-2 text-lg font-semibold text-primary tabular-nums">
                    {fmtMoney(totals.prices[i]?.price, currency) || "—"}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <TableCard.Root className="mt-6">
        <TableCard.Header
          title={t("Сохранённые расчёты")}
          badge={<Badge size="sm" color="brand" type="pill-color">{saved.length}</Badge>}
        />
        <Table size="sm" aria-label={t("Сохранённые расчёты")} onRowAction={(key) => navigate(`/cost/${key}`)}>
          <Table.Header>
            <Table.Head id="name" isRowHeader label={t("Название")} className="w-full" />
            <Table.Head id="revision" label={t("Версия")} className="px-3" />
            <Table.Head id="landed" label={t("Себестоимость")} className="px-3" />
            <Table.Head id="updated" label={t("Изменён")} className="px-3" />
          </Table.Header>
          <Table.Body items={saved} renderEmptyState={() => <EmptyNote>{t("Пока нет сохранённых расчётов")}</EmptyNote>}>
            {(e) => (
              <Table.Row id={e.id}>
                <Table.Cell>
                  <span className={e.id === id ? "font-semibold text-brand-secondary" : "font-medium text-primary"}>{e.name}</span>
                </Table.Cell>
                <Table.Cell className="px-3 text-tertiary">{e.revision || "—"}</Table.Cell>
                <Table.Cell className="px-3 whitespace-nowrap tabular-nums">{fmtMoney(e.landed_cost, e.currency)}</Table.Cell>
                <Table.Cell className="px-3 whitespace-nowrap text-tertiary">{fmtDate(e.updated_at)}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      </TableCard.Root>
    </div>
  );
}
