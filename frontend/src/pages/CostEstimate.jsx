import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { compute, machineRate, resolveRates, DEFAULTS, DEFAULT_MARGINS, PRINTER_KEYS } from "../cost.js";
import { CURRENCIES, currencySign, fmtMoney } from "../format.js";
import { dateLocale, t } from "../i18n.js";
import Icon from "../components/Icon.jsx";
import Hint from "../components/Hint.jsx";

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

// Строка списка «кол-во × цена»: комплектующие и упаковка устроены одинаково.
function ItemRows({ items, onChange, currency, addLabel }) {
  const setRow = (i, patch) =>
    onChange(items.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  return (
    <>
      <table className="cards-mobile">
        <thead>
          <tr>
            <th>{t("Название")}</th>
            <th style={{ width: 110 }}>{t("Кол-во")}</th>
            <th style={{ width: 130 }}>{t("Цена за штуку")}</th>
            <th style={{ width: 110 }}>{t("Сумма")}</th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              <td data-label={t("Название")}>
                <input
                  value={row.name}
                  placeholder={t("например, винт M3×12")}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                />
              </td>
              <td data-label={t("Кол-во")}>
                <input type="number" min="0" step="any" value={row.qty}
                  onChange={(e) => setRow(i, { qty: e.target.value })} />
              </td>
              <td data-label={t("Цена за штуку")}>
                <input type="number" min="0" step="any" value={row.unit_cost}
                  onChange={(e) => setRow(i, { unit_cost: e.target.value })} />
              </td>
              <td data-label={t("Сумма")} className="mono">
                {fmtMoney(Number(row.qty || 0) * Number(row.unit_cost || 0), currency)}
              </td>
              <td data-label="">
                <button
                  className="icon-btn"
                  title={t("Убрать строку")}
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                >
                  <Icon name="trash" size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary" style={{ marginTop: 8 }} onClick={() => onChange([...items, emptyRow()])}>
        {addLabel}
      </button>
    </>
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
    if (!confirm(t("Удалить этот расчёт?"))) return;
    try {
      await api.del(`/api/cost-estimates/${id}`);
      loadSaved();
      navigate("/cost");
    } catch (e) { setError(e.message); }
  }

  const rate = machineRate(rates);

  return (
    <div>
      <h2>{t("Расчёт стоимости печати")}</h2>
      <p className="muted">
        {t("Полная себестоимость изделия: филамент, электричество, износ принтера, ваше время и упаковка — и цена, которая оставляет нужную наценку.")}
      </p>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <h3 className="card-title">{t("Исходные данные")}</h3>
        <div className="row">
          <label>
            {t("Взять из печати")}
            <select value={jobId} onChange={(e) => pickJob(e.target.value)}>
              <option value="">{t("— заполнить вручную —")}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {(j.file_name || t("без файла")).split("/").pop()} · {fmtDate(j.completed_at || j.created_at)}
                  {j.consumed_g != null ? ` · ${j.consumed_g.toFixed(0)} ${t("г")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Принтер")}
            <Hint text={t("Чьи тарифы пойдут в стоимость машиночаса. Задаются на странице «Принтеры» → «Себестоимость». Без принтера берутся значения по умолчанию.")} />
            <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
              <option value="">{t("— общие настройки —")}</option>
              {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <div className="row">
          <label>
            {t("Название изделия")}
            <input value={form.part_name} onChange={(e) => set({ part_name: e.target.value })} />
          </label>
          <label>
            {t("Версия")}
            <input value={form.revision} placeholder="V1" onChange={(e) => set({ revision: e.target.value })} />
          </label>
          <label>
            {t("Дата")}
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <label>
            {t("Материал")}
            <input value={form.material} placeholder="PETG" onChange={(e) => set({ material: e.target.value })} />
          </label>
          <label>
            {t("Валюта")}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c} {currencySign(c)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {/* Курса у приложения нет, и заводить его ради подписи не стоит:
              валюта здесь говорит, в чём заданы числа, а не пересчитывает их. */}
          {t("Смена валюты не пересчитывает числа — она только подписывает суммы. Все цифры, включая параметры принтера, должны быть в одной валюте.")}
        </div>

        <div className="row">
          <label>
            {label("Цена филамента, %s/кг")}
            <Hint text={t("Во сколько вам обошёлся килограмм этого пластика. Если взять данные из готовой печати, цена подставится по фактически списанным катушкам.")} />
            <input type="number" min="0" step="any" value={form.filament_price_per_kg}
              onChange={(e) => { set({ filament_price_per_kg: e.target.value }); setPriceFromJob(null); }} />
          </label>
          <label>
            {t("Филамента на изделие, г")}
            <input type="number" min="0" step="any" value={form.filament_g}
              onChange={(e) => set({ filament_g: e.target.value })} />
          </label>
          <label>
            {t("Время печати, ч")}
            <Hint text={t("Сколько принтер печатает всю партию. Из этих часов и тарифов принтера получается стоимость машиночаса — износ плюс электричество.")} />
            <input type="number" min="0" step="any" value={form.print_time_h}
              onChange={(e) => set({ print_time_h: e.target.value })} />
          </label>
          <label>
            {t("Работа руками, мин")}
            <Hint text={t("Ваше время на всю партию: снять со стола, убрать поддержки, зашкурить, собрать, упаковать. Время печати сюда не входит — принтер работает сам.")} />
            <input type="number" min="0" step="any" value={form.labor_min}
              onChange={(e) => set({ labor_min: e.target.value })} />
          </label>
          <label>
            {label("Ставка труда, %s/ч")}
            <Hint text={t("Во сколько вы оцениваете свой час работы. Умножается на «работу руками» — на время печати не влияет.")} />
            <input type="number" min="0" step="any" value={form.labor_per_hour}
              onChange={(e) => set({ labor_per_hour: e.target.value })} />
          </label>
          <label>
            {t("Расход филамента, ×")}
            <Hint text={t("Насколько пластика уходит больше, чем весит сама деталь: юбка, поддержки, продувка при смене цвета, неудачные попытки. 1.1 значит «прибавить 10 %»; 1 — считать ровно по весу детали.")} />
            <input type="number" min="1" step="0.05" value={form.material_efficiency}
              onChange={(e) => set({ material_efficiency: e.target.value })} />
          </label>
          <label>
            {t("Штук в партии")}
            <Hint text={t("Сколько изделий печатается за раз. Умножается только филамент: время печати и работа руками задаются сразу на всю партию.")} />
            <input type="number" min="1" step="1" value={form.qty}
              onChange={(e) => set({ qty: e.target.value })} />
          </label>
        </div>
        {priceFromJob && (
          <div className="muted" style={{ fontSize: 12 }}>
            {t("Цена филамента посчитана по фактически списанным катушкам.")}
            {priceFromJob.partial && ` ${t("(часть катушек без цены — итог занижен)")}`}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">{t("Комплектующие")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          {t("Всё, что входит в изделие кроме филамента: крепёж, магниты, вставки, электроника.")}
        </p>
        <ItemRows
          items={form.hardware}
          onChange={(hardware) => set({ hardware })}
          currency={currency}
          addLabel={t("Добавить комплектующее")}
        />
      </div>

      <div className="card">
        <h3 className="card-title">{t("Упаковка и доставка")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          {t("Коробка, плёнка, скотч, вкладыш — и почтовые расходы, если доставка за ваш счёт.")}
        </p>
        <ItemRows
          items={form.packaging}
          onChange={(packaging) => set({ packaging })}
          currency={currency}
          addLabel={t("Добавить упаковку")}
        />
      </div>

      <div className="printer-lifetime">
        <div className="printer-lifetime-head">
          <div>
            <div className="printer-lifetime-title">{t("Себестоимость")}</div>
            <div className="printer-lifetime-subtitle">
              {t("Час печати обходится в")}{" "}{fmtMoney(rate.total_per_hour, currency)}
              {printer ? ` · ${printer.name}` : ""}
            </div>
          </div>
        </div>
        <div className="printer-lifetime-body">
          <div className="printer-lifetime-hero">
            <span>{t("Полная себестоимость")}</span>
            <b>{fmtMoney(totals.landed_total, currency)}</b>
            <em>{t("за всю партию")}</em>
          </div>
          <div className="printer-lifetime-grid">
            <div className="printer-lifetime-stat">
              <span>{t("Материалы")}</span>
              <b>{fmtMoney(totals.materials_total, currency)}</b>
              <em>{t("филамент и комплектующие")}</em>
            </div>
            <div className="printer-lifetime-stat">
              <span>{t("Работа руками")}</span>
              <b>{fmtMoney(totals.labor_total, currency)}</b>
              <em>{fmtMoney(rates.labor_per_hour, currency)}{" "}{t("в час")}</em>
            </div>
            <div className="printer-lifetime-stat">
              <span>{t("Принтер")}</span>
              <b>{fmtMoney(totals.machine_total, currency)}</b>
              <em>{t("износ и электричество")}</em>
            </div>
            <div className="printer-lifetime-stat">
              <span>{t("Упаковка")}</span>
              <b>{fmtMoney(totals.packaging_total, currency)}</b>
              <em>{t("и доставка")}</em>
            </div>
          </div>
        </div>
      </div>

      {stale && (
        <div className="card" style={{ borderColor: "var(--hot)" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <div>
              {t("Расчёт считается по параметрам принтера на момент сохранения — с тех пор их поменяли.")}
            </div>
            <button className="secondary" onClick={refreshRates}>{t("Пересчитать по тарифам принтера")}</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">{t("Цена по наценке")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          {t("Наценка считается от цены продажи: при 60 % себестоимость составляет 40 % от неё.")}
        </p>
        <div className="row">
          {form.margins.map((m, i) => (
            <label key={i}>
              {t("Наценка, %")}
              {i === 0 && (
                <Hint text={t("Доля цены продажи, которая остаётся вам сверх себестоимости. При 60 % себестоимость составляет 40 % цены, то есть цена = себестоимость ÷ 0,4. Это не «накрутка сверху»: наценка 100 % невозможна.")} />
              )}
              <input type="number" min="0" max="99" step="any" value={m}
                onChange={(e) => set({ margins: form.margins.map((x, idx) => (idx === i ? e.target.value : x)) })} />
              <b className="mono" style={{ display: "block", marginTop: 6, fontSize: "var(--fs-5)" }}>
                {fmtMoney(totals.prices[i]?.price, currency) || "—"}
              </b>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ flex: "1 1 100%" }}>
            {t("Заметки")}
            <input value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => save()} disabled={busy}>
            {id ? t("Сохранить") : t("Сохранить расчёт")}
          </button>
          {id && (
            <>
              <button className="secondary" onClick={() => save({ asNew: true })} disabled={busy}>
                {t("Сохранить как новый")}
              </button>
              <button className="secondary" onClick={remove}>{t("Удалить")}</button>
              <button className="secondary" onClick={() => navigate("/cost")}>{t("Новый расчёт")}</button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">{t("Сохранённые расчёты")}</h3>
        <table className="cards-mobile">
          <thead>
            <tr>
              <th>{t("Название")}</th>
              <th>{t("Версия")}</th>
              <th>{t("Себестоимость")}</th>
              <th>{t("Изменён")}</th>
            </tr>
          </thead>
          <tbody>
            {saved.map((e) => (
              <tr
                key={e.id}
                onClick={() => navigate(`/cost/${e.id}`)}
                style={{ cursor: "pointer", fontWeight: e.id === id ? 700 : 400 }}
              >
                <td data-label={t("Название")}>{e.name}</td>
                <td data-label={t("Версия")} className="muted">{e.revision || "—"}</td>
                <td data-label={t("Себестоимость")} className="mono">{fmtMoney(e.landed_cost, e.currency)}</td>
                <td data-label={t("Изменён")} className="muted">{fmtDate(e.updated_at)}</td>
              </tr>
            ))}
            {saved.length === 0 && (
              <tr><td colSpan={4} className="muted">{t("Пока нет сохранённых расчётов")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
