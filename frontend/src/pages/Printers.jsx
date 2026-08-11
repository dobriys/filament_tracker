import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { fmtMoney } from "../format.js";
import { t, dateLocale, tServer } from "../i18n.js";
import { GateCard } from "../components/HubGates.jsx";
import { PrinterArt, CapabilityChips, brandAccent } from "../components/PrinterArt.jsx";
import Icon from "../components/Icon.jsx";
import Hint from "../components/Hint.jsx";
import SpoolPicker from "../components/SpoolPicker.jsx";
import FeedChangeBanner from "../components/FeedChangeBanner.jsx";
import LightToggle from "../components/LightToggle.jsx";
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

  // Пресеты, сгруппированные по бренду — для <optgroup> в селекте модели.
  const presetGroups = presets.reduce((acc, p) => {
    const g = p.brand || t("Общие");
    (acc[g] = acc[g] || []).push(p);
    return acc;
  }, {});

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

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function remove(p) {
    if (!window.confirm(`${t("Удалить принтер")} «${p.name}»? ${t("Его слоты и история назначений будут удалены.")}`)) return;
    await api.del(`/api/printers/${p.id}`);
    if (selected?.id === p.id) setSelected(null);
    if (mrPrinter?.id === p.id) setMrPrinter(null);
    if (costPrinter?.id === p.id) setCostPrinter(null);
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>{t("Принтеры")}</h2>
        <button onClick={() => setShowForm(!showForm)}>{showForm ? t("Отмена") : t("+ Добавить")}</button>
      </div>

      {showForm && (
        <form className="card" onSubmit={create}>
          <div className="row">
            <div>
              <label>{t("Модель принтера")}</label>
              <select value={form.preset_key} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">{t("— выбрать модель —")}</option>
                {Object.entries(presetGroups).map(([brand, items]) => (
                  <optgroup key={brand} label={brand}>
                    {items.map((p) => <option key={p.key} value={p.key}>{p.model}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div><label>{t("Название")}</label><input value={form.name} onChange={set("name")} required /></div>
          </div>
          {form.preset_key && (
            <div className="preset-preview" style={{ "--brand": brandAccent(form.brand) }}>
              <PrinterArt caps={form.capabilities || {}} brand={form.brand} model={form.model} size={56} />
              <div>
                {(form.brand || form.model) && <div className="printer-head-sub">{[form.brand, form.model].filter(Boolean).join(" ")}</div>}
                <CapabilityChips caps={form.capabilities || {}} />
                {form.note && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                    {form.note.split(" · ").map((seg) => t(seg)).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="row">
            <div>
              <label>{t("Тип интеграции")}</label>
              <select value={form.integration_type} onChange={set("integration_type")}>
                <option value="manual">{t("Ручной")}</option>
                <option value="moonraker">Moonraker</option>
              </select>
            </div>
            <div><label>{t("Количество слотов")}</label><input type="number" value={form.slot_count} onChange={set("slot_count")} /></div>
          </div>
          {form.integration_type === "moonraker" && (
            <div className="row">
              <div><label>Moonraker URL</label><input value={form.moonraker_url} onChange={set("moonraker_url")} placeholder="http://192.168.1.50:7125" /></div>
              <div><label>{t("API-ключ (если требуется)")}</label><input value={form.moonraker_api_key} onChange={set("moonraker_api_key")} placeholder={t("необязательно")} /></div>
            </div>
          )}
          <button style={{ marginTop: 12 }}>{t("Создать")}</button>
        </form>
      )}

      <div className="card">
        <table className="cards-mobile">
          <thead><tr><th>{t("Название")}</th><th>{t("Модель")}</th><th>{t("Интеграция")}</th><th>{t("Активен")}</th><th></th></tr></thead>
          <tbody>
            {printers.map((p) => (
              <tr key={p.id}>
                <td data-label={t("Название")}>{p.name}</td>
                <td data-label={t("Модель")} className="muted">{[p.brand, p.model].filter(Boolean).join(" ") || "—"}</td>
                <td data-label={t("Интеграция")}>{p.integration_type}</td>
                <td data-label={t("Активен")}>{p.is_active ? t("да") : t("нет")}</td>
                <td data-label="">
                  <button className="secondary" onClick={() => setSelected(p)}>{t("Слоты")}</button>{" "}
                  {p.integration_type === "moonraker" && (
                    <button className="secondary" onClick={() => setMrPrinter(p)}>Moonraker</button>
                  )}{" "}
                  <button className="secondary" onClick={() => setCostPrinter(p)}>{t("Себестоимость")}</button>{" "}
                  <button className="danger" onClick={() => remove(p)}>{t("Удалить")}</button>
                </td>
              </tr>
            ))}
            {printers.length === 0 && <tr><td colSpan={5} className="muted">{t("Пока нет принтеров")}</td></tr>}
          </tbody>
        </table>
      </div>

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
      {mrPrinter && <MoonrakerPanel printer={mrPrinter} onClose={() => setMrPrinter(null)} />}
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
    <div className="card">
      {/* Обычный flex, а не .row: там у детей flex:1, и кнопка растянулась бы
          во всю ширину. Так же устроены шапки соседних панелей. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h3 className="card-title" style={{ margin: 0 }}>
          {t("Себестоимость")}: {printer.name}
        </h3>
        <button className="secondary" onClick={onClose}>{t("Закрыть")}</button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {t("Отсюда берётся стоимость машиночаса в расчёте стоимости печати. Пустое поле — значение по умолчанию, оно стоит в подсказке. Валюта выбирается в самом расчёте, здесь важно, чтобы все цифры были в одной.")}
      </p>
      <div className="row">
        {FIELDS.map(({ key, label, step, hint }) => (
          <label key={key}>
            {label}
            {hint && <Hint text={hint} />}
            <input
              type="number"
              min="0"
              step={step || "any"}
              value={draft[key] ?? ""}
              placeholder={String(DEFAULTS[key] ?? "—")}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="low-explain" style={{ marginTop: 10 }}>
        {t("Час печати обходится в")}{" "}
        <b className="mono">{round2(rate.total_per_hour)}</b>
        {" — "}
        {t("износ")}{" "}
        <b className="mono">{round2(rate.capital_per_hour)}</b>
        {" + "}
        {t("электричество")}{" "}
        <b className="mono">{round2(rate.electric_per_hour)}</b>
      </div>
      {err && <div className="error">{err}</div>}
      <button onClick={save} disabled={busy} style={{ marginTop: 12 }}>{t("Сохранить")}</button>
    </div>
  );
}

function MoonrakerPanel({ printer, onClose }) {
  const [conn, setConn] = useState(null);
  const [ov, setOv] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
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

  return (
    <div className="card moonraker-card" style={{ "--brand": brandAccent(printer.brand) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <PrinterArt caps={ov?.capabilities || printer.capabilities || {}} brand={printer.brand} model={printer.model} size={50} />
          <div>
            <h3 style={{ margin: 0 }}>Moonraker — {printer.name}</h3>
            {[printer.brand, printer.model].filter(Boolean).length > 0 && (
              <div className="printer-head-sub">{[printer.brand, printer.model].filter(Boolean).join(" ")}</div>
            )}
          </div>
        </div>
        <button className="secondary" onClick={onClose}>{t("Закрыть")}</button>
      </div>
      <div className="muted" style={{ marginTop: 6, marginBottom: 8 }}>{printer.moonraker_url}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="secondary" onClick={testConn}>{t("Тест соединения")}</button>
        <button className="secondary" onClick={() => { loadOverview(); loadJobs(); }}>{t("Обновить")}</button>
        <LightToggle printerId={printer.id} light={ov?.light} onChanged={loadOverview} onError={setError} />
      </div>
      {error && <div className="error">{error}</div>}

      {conn && (
        <div style={{ marginTop: 12 }} className={conn.ok ? "" : "error"}>
          <Icon name={conn.ok ? "check" : "alert"} size={14} /> {tServer(conn.detail)}
        </div>
      )}

      {ov?.gates?.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 10px" }} className="inline-ico"><Icon name="slots" /> {mmuLabel(ov?.capabilities)} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{t("— что принтер видит в слотах и совпадает ли это с привязанными катушками")}</span></h4>
          <div className="hub-gates">
            {ov.gates.map((g) => <GateCard key={g.gate} g={g} />)}
          </div>
        </div>
      )}

      {/* Мультиподача у принтера есть, но сейчас снята — вместо пустого места
          объясняем, почему нет слотов и сушилки. */}
      {ov?.capabilities?.mmu_off && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 6px" }} className="inline-ico">
            <Icon name="spool" /> {t("Прямая подача")}
          </h4>
          <div className="muted" style={{ fontSize: 13 }}>
            {ov.capabilities.mmu_name || t("Мультиподача")}{" "}
            {ov.capabilities.feed_mode_setting === "direct"
              ? t("отключена вручную — слоты и сушилка скрыты.")
              : t("не в работе: принтер сообщает, что хаб отключён, — печать идёт с одной катушки.")}{" "}
            {t("Режим переключается в «Слотах».")}
          </div>
        </div>
      )}

      {ov?.dryer && (
        <DryerCard printer={printer} dryer={ov.dryer} onChanged={loadOverview} />
      )}

      {st && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 10px" }} className="inline-ico"><Icon name="signal" /> {t("Телеметрия")}</h4>
          <div className="row" style={{ fontSize: 14 }}>
            <div><span className="muted">{t("Состояние:")}</span> {st.state || "—"}</div>
            <div><span className="muted">{t("Сопло:")}</span> {st.nozzle_temp != null ? Math.round(st.nozzle_temp) + "°" : "—"}{st.nozzle_target > 0 ? ` / ${Math.round(st.nozzle_target)}°` : ""}</div>
            <div><span className="muted">{t("Стол:")}</span> {st.bed_temp != null ? Math.round(st.bed_temp) + "°" : "—"}{st.bed_target > 0 ? ` / ${Math.round(st.bed_target)}°` : ""}</div>
            <div><span className="muted">{t("Обдув модели:")}</span> {pct(st.part_fan)}</div>
            <div><span className="muted">{t("Вент. корпуса:")}</span> {pct(st.box_fan)}</div>
            <div><span className="muted">{t("Фильтр воздуха:")}</span> {pct(st.air_filter_fan)}</div>
            <div><span className="muted">{t("Скорость:")}</span> {pct(st.speed_factor)}</div>
            <div><span className="muted">{t("Поток:")}</span> {pct(st.extrude_factor)}</div>
            {st.state === "printing" && <div><span className="muted">{t("Прогресс:")}</span> {pct(st.progress)}</div>}
          </div>
        </div>
      )}

      {totals && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 10px" }} className="inline-ico"><Icon name="chart" /> {t("Статистика за всю жизнь принтера")}</h4>
          <div className="hub-stats">
            <div><b>{totals.total_jobs}</b><span className="muted">{t("печатей")}</span></div>
            <div><b>{Math.round((totals.total_print_time_sec || 0) / 3600)} {t("ч")}</b><span className="muted">{t("чистой печати")}</span></div>
            <div><b>{((totals.total_filament_mm || 0) / 1e6).toFixed(2)} {t("км")}</b><span className="muted">{t("филамента")}</span></div>
            <div><b>{((totals.longest_print_sec || 0) / 3600).toFixed(1)} {t("ч")}</b><span className="muted">{t("самая долгая")}</span></div>
          </div>
        </div>
      )}

      {sysinfo && (sysinfo.cpu || sysinfo.os || sysinfo.moonraker_version) && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          <Icon name="wrench" size={14} /> {[
            sysinfo.os,
            sysinfo.cpu,
            sysinfo.klipper_version ? `Klipper ${sysinfo.klipper_version}` : null,
            sysinfo.moonraker_version && sysinfo.moonraker_version !== "?" ? `Moonraker ${sysinfo.moonraker_version}` : null,
          ].filter(Boolean).join(" · ")}
        </div>
      )}

      {jobs && (
        <table className="cards-mobile" style={{ marginTop: 12 }}>
          <thead><tr><th>{t("Файл")}</th><th>{t("Статус")}</th><th>{t("Филамент, г")}</th><th>{t("Слайсер")}</th><th></th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.job_id}>
                <td data-label={t("Файл")}>{(j.filename || "").split("/").pop()}</td>
                <td data-label={t("Статус")}>{j.status}</td>
                <td data-label={t("Филамент, г")}>{j.filament_total_g != null ? Number(j.filament_total_g).toFixed(1) : (j.filament_used_mm != null ? Math.round(j.filament_used_mm) + " " + t("мм") : "—")}</td>
                <td data-label={t("Слайсер")}>{j.slicer || "—"}</td>
                <td data-label="">
                  {j.consumed ? (
                    <span className="badge added" title={j.consumed_via === "manual" ? t("Файл уже списан вручную") : t("Уже списано из Moonraker")}>
                      <Icon name="check" size={13} /> {t("Списано")}{j.cost != null ? ` · ${fmtMoney(j.cost, j.cost_currency)}` : ""}
                    </span>
                  ) : j.status === "completed" ? (
                    <button className="secondary" onClick={() => consumeJob(j.job_id)}>{t("Списать")}</button>
                  ) : j.filament_used_mm > 0 ? (
                    // Печать оборвана, но филамент израсходован — списываем по факту.
                    <button className="secondary" title={t("Печать прервана — спишется фактически израсходованная длина")}
                      onClick={() => consumeJob(j.job_id)}>{t("Списать по факту")}</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={5} className="muted">{t("Нет завершённых заданий")}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
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
  if (!spool) return <span className="badge in_use">{fallback}</span>;
  const e = enrichSpool(spool, { profiles, locations });
  return (
    <span className="slot-spool">
      <span className="slot-spool-head">
        <span className="sp-dot" style={{ background: e.colorHex || "var(--panel-3)" }} />
        <span className="slot-spool-title">{e.title}</span>
      </span>
      <span className="muted">{[e.material, e.colorName].filter(Boolean).join(" · ")}</span>
      <span className={`mono sp-opt-g${e.low ? " low" : ""}`}>{e.remaining.toFixed(0)}{" "}{t("г")}</span>
    </span>
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

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h3>{t("Слоты —")}{" "}{printer.name}</h3>
        <div>
          <button className="secondary" onClick={addSlot}>{t("+ Слот")}</button>{" "}
          <button className="secondary" onClick={onClose}>{t("Закрыть")}</button>
        </div>
      </div>

      <div className="feed-mode">
        <label htmlFor={`feed-${printer.id}`}>{t("Подача филамента")}</label>
        <select id={`feed-${printer.id}`} value={mode} disabled={busy}
          onChange={(e) => setFeedMode(e.target.value)}>
          <option value="auto">{t("Авто — по телеметрии принтера")}</option>
          <option value="mmu">{t("Мультиподача (хаб со слотами)")}</option>
          <option value="direct">{t("Прямая подача — одна катушка")}</option>
        </select>
        <div className="muted feed-mode-note">
          {mode === "auto"
            ? t("Пока хаб отключён от принтера, приложение само держит прямую подачу и вернёт слоты, когда он снова окажется в работе.")
            : mode === "direct"
              ? holder
                ? t("Активна только внешняя катушка — та, что стоит на держателе; по ней же идёт автосписание. Слоты хаба выключены, их история сохранена.")
                : t("Активен только слот 1 — в него ставится катушка с держателя, по нему же идёт автосписание. Остальные слоты выключены, их история сохранена.")
              : t("Слоты хаба включены, даже если он сейчас молчит.")}
        </div>
      </div>

      {feedChange && (
        <FeedChangeBanner printer={printer} change={feedChange} onConfirmed={onFeedConfirmed} />
      )}

      {hubHidden && (
        <div className="muted feed-mode-note" style={{ marginBottom: 10 }}>
          <Icon name="alert" size={13} />{" "}
          {t("Слоты хаба скрыты — он сейчас не подключён. Катушки остались привязанными, история цела.")}
        </div>
      )}

      <table className="cards-mobile">
        <thead><tr><th>{t("Слот")}</th><th>{t("Текущая катушка")}</th><th>{t("Назначить")}</th><th></th></tr></thead>
        <tbody>
          {shownSlots.map((s) => (
            <tr key={s.id} className={s.is_active ? "" : "slot-off"}>
              <td data-label={t("Слот")}>
                {slotLabel(s)}
                {!s.is_active && <span className="badge" style={{ marginLeft: 6 }}>{t("выключен")}</span>}
              </td>
              <td data-label={t("Текущая катушка")}>
                {s.current_spool_id
                  ? <SlotSpool spool={spoolById(s.current_spool_id)} fallback={s.current_spool_label}
                      profiles={profiles} locations={locations} />
                  : <span className="muted">{t("пусто")}</span>}
              </td>
              <td data-label={t("Назначить")}>
                {s.is_active ? (
                  <SpoolPicker
                    spools={spools}
                    profiles={profiles}
                    locations={locations}
                    occupied={occupied}
                    onSelect={(spoolId) => assign(s.id, spoolId)}
                  />
                ) : (
                  <span className="muted">{t("слот не используется")}</span>
                )}
              </td>
              <td data-label="">
                {s.current_spool_id && <button className="secondary" onClick={() => unassign(s.id)}>{t("Снять")}</button>}{" "}
                <button className="secondary" onClick={() => toggleSlot(s)}>{s.is_active ? t("Отключить слот") : t("Включить слот")}</button>{" "}
                <button className="secondary" onClick={() => showHistory(s.id)}>{t("История")}</button>
              </td>
            </tr>
          ))}
          {shownSlots.length === 0 && <tr><td colSpan={4} className="muted">{t("Нет слотов")}</td></tr>}
        </tbody>
      </table>

      {history && (
        <div style={{ marginTop: 12 }}>
          <h4>{t("История назначений")}</h4>
          <table className="cards-mobile">
            <thead><tr><th>{t("Катушка")}</th><th>{t("Назначена")}</th><th>{t("Снята")}</th></tr></thead>
            <tbody>
              {history.rows.map((r) => (
                <tr key={r.id}>
                  <td data-label={t("Катушка")}>{spoolLabel(r.spool_id)}</td>
                  <td data-label={t("Назначена")}>{new Date(r.assigned_at).toLocaleString(dateLocale())}</td>
                  <td data-label={t("Снята")}>{r.unassigned_at ? new Date(r.unassigned_at).toLocaleString(dateLocale()) : <span className="badge in_use">{t("сейчас")}</span>}</td>
                </tr>
              ))}
              {history.rows.length === 0 && <tr><td colSpan={3} className="muted">{t("Пусто")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h4 style={{ margin: 0 }}>
          <Icon name="flame" size={15} className="hot" /> {t("Сушка филамента")}{" "}
          {drying
            ? <span className="act-tag in_use">{t("сушит")} {dryer.target_temp}°C{remainingLabel ? ` · ${t("осталось")} ${remainingLabel}` : durationLabel ? ` · ${t("Длительность")} ${durationLabel}` : ""}</span>
            : dryer.status === "heater_err"
            ? <span className="act-tag used">{t("ошибка нагревателя")}</span>
            : <span className="act-tag">{t("выключена")}</span>}
        </h4>
        {dryer.humidity > 0 && <span className="muted inline-ico" style={{ fontSize: "var(--fs-3)" }}><Icon name="droplet" size={13} /> {dryer.humidity}%</span>}
      </div>
      <div className="dryer-presets">
        <div className="dryer-presets-label">{t("Профили сушки")}</div>
        <div className="dryer-presets-list">
          {DRYER_PRESETS.map((preset) => (
            <button
              key={preset.material}
              className="dryer-preset"
              disabled={busy || drying}
              onClick={() => send("start", preset)}
              title={
                drying
                  ? t("Выключите текущую сушку перед запуском профиля")
                  : `${preset.material}: ${preset.temp}°C · ${preset.hours} ${t("ч")}`
              }
            >
              <span className="dryer-preset-material">{preset.material}</span>
              <span className="dryer-preset-values">
                <span>{preset.temp}°C</span>
                <span>{preset.hours} {t("ч")}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ width: 130 }}>
          <label>{t("Температура, °C")}</label>
          <input type="number" min="35" max="70" value={temp} onChange={(e) => setTemp(e.target.value)} disabled={drying} />
        </div>
        <div style={{ width: 110 }}>
          <label>{t("Время, ч")}</label>
          <input type="number" min="0.5" max="24" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} disabled={drying} />
        </div>
        {drying
          ? <button className="danger" disabled={busy} onClick={() => send("stop")}>{t("Выключить")}</button>
          : <button disabled={busy} onClick={() => send("start")}>{t("Включить сушку")}</button>}
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
