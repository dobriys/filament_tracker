"""Клиент Moonraker (совместим с Rinkhals).

Делает HTTP-запросы к Moonraker API и нормализует ответы. Парсеры вынесены
отдельными функциями, чтобы их можно было тестировать без живого принтера.
Аутентификация — заголовок X-Api-Key (если задан ключ).
"""
import re

import httpx

DEFAULT_TIMEOUT = 5.0


def parse_printer_info(payload: dict) -> dict:
    r = payload.get("result", payload) or {}
    return {
        "state": r.get("state"),
        "state_message": r.get("state_message"),
        "hostname": r.get("hostname"),
        "software_version": r.get("software_version"),
    }


def _num(v) -> float | None:
    """Число из значения Moonraker; Anycubic шлёт часть полей с единицами ('14.40g')."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v))
    return float(m.group()) if m else None


def is_preparing(print_stats: dict) -> bool:
    """Принтер взял задание, но ещё не печатает: калибровка стола, хоминг, прогрев.

    Anycubic/Rinkhals не отдаёт отдельного флага — во время автокалибровки
    print_stats.state и idle_timeout уже равны "printing" (а virtual_sdcard.
    is_homing равен 2 и в калибровке, и в печати, то есть фазу не отличает).
    Честный признак — нулевые счётчики самой печати: пока идёт подготовка,
    прошивка держит print_duration и filament_used в нуле, а на первой же
    выдавленной пруж-линии оба уходят в плюс.
    """
    if print_stats.get("state") != "printing":
        return False
    return not (print_stats.get("print_duration") or 0) and not (
        print_stats.get("filament_used") or 0
    )


def parse_status(payload: dict) -> dict:
    r = payload.get("result", payload) or {}
    status = r.get("status", {}) or {}
    ps = status.get("print_stats", {}) or {}
    ds = status.get("display_status", {}) or {}
    vsd = status.get("virtual_sdcard", {}) or {}
    bed = status.get("heater_bed", {}) or {}
    ext = status.get("extruder", {}) or {}
    fan = status.get("fan", {}) or {}
    gm = status.get("gcode_move", {}) or {}
    box_fan = status.get("fan_generic box_fan", {}) or {}
    air_fan = status.get("fan_generic air_filter_fan", {}) or {}
    info = ps.get("info", {}) or {}
    return {
        "state": ps.get("state"),
        # Текст ошибки от прошивки (Klipper кладёт сюда сообщение при state="error").
        "message": ps.get("message") or None,
        "filename": ps.get("filename") or None,
        "print_duration_sec": ps.get("print_duration"),
        "total_duration_sec": ps.get("total_duration"),
        "filament_used_mm": ps.get("filament_used"),
        "progress": ds.get("progress") if ds.get("progress") is not None else vsd.get("progress"),
        # Подготовка перед печатью (калибровка стола, хоминг, прогрев): состояние
        # у прошивки уже "printing", но фактическая печать ещё не началась.
        "preparing": is_preparing(ps),
        # Данные от самой прошивки — точнее наших оценок по прогрессу.
        "remaining_sec": _num(vsd.get("remain_time")),
        "estimated_total_sec": _num(vsd.get("total_time")),
        "current_layer": info.get("current_layer") or vsd.get("current_layer"),
        "total_layer": info.get("total_layer") or vsd.get("total_layer"),
        # filament_used_g/filament_total_g из virtual_sdcard намеренно не берём:
        # Anycubic заполняет их только на экране старта задания, а с началом
        # печати обнуляет — расход считаем по истории при списании.
        "filament_type": vsd.get("filament_type") or None,
        "nozzle_temp": ext.get("temperature"),
        "nozzle_target": ext.get("target"),
        "bed_temp": bed.get("temperature"),
        "bed_target": bed.get("target"),
        # телеметрия
        "part_fan": fan.get("speed"),               # обдув модели, 0..1
        "box_fan": box_fan.get("speed"),            # вентилятор корпуса, 0..1
        "air_filter_fan": air_fan.get("speed"),     # фильтр воздуха, 0..1
        "speed_factor": gm.get("speed_factor"),     # множитель скорости
        "extrude_factor": gm.get("extrude_factor"), # множитель потока
    }


def parse_hub(payload: dict) -> list[dict]:
    """Гейты ACE-хаба (ota_filament_hub → mmu): занятость, материал, цвет.

    Гейты нумеруются с 0; физический слот принтера = gate + 1.
    Цвет приходит как RGBA-hex (B81B0EFF) — обрезаем до #RRGGBB.
    """
    r = payload.get("result", payload) or {}
    mmu = (r.get("status", {}) or {}).get("mmu", {}) or {}
    n = mmu.get("num_gates") or 0
    statuses = mmu.get("gate_status") or []
    materials = mmu.get("gate_material") or []
    colors = mmu.get("gate_color") or []
    temps = mmu.get("gate_temperature") or []
    gates = []
    for i in range(n):
        raw = (colors[i] if i < len(colors) else "") or ""
        gates.append(
            {
                "gate": i,
                "slot_index": i + 1,
                "occupied": bool(statuses[i]) if i < len(statuses) else False,
                "material": (materials[i] if i < len(materials) else None) or None,
                "color_hex": f"#{raw[:6]}" if len(raw) >= 6 else None,
                "temp": temps[i] if i < len(temps) else None,
            }
        )
    return gates


def parse_hub_enabled(payload: dict) -> bool | None:
    """Включена ли мультиподача (mmu.enabled). None — объекта mmu нет вовсе.

    Отсоединённый ACE не пропадает из телеметрии: Rinkhals продолжает отдавать
    и num_gates, и нули сушилки, — но ставит enabled=false. Так что «хаб снят»
    видно именно по этому флагу, а не по пустым гейтам.
    """
    r = payload.get("result", payload) or {}
    mmu = (r.get("status", {}) or {}).get("mmu")
    if not isinstance(mmu, dict) or "enabled" not in mmu:
        return None
    return bool(mmu["enabled"])


def parse_ext_spool(payload: dict) -> dict | None:
    """Внешняя (прямая) катушка по объекту filament_hub.

    Объекта нет в /printer/objects/list, но на запрос он отвечает — именно там
    Rinkhals держит единственный прямой признак прямой подачи:
      * ext_spool / ext_spool_status — держатель внешней катушки задействован;
      * filament_hubs — список подключённых ACE; null означает, что хаба нет.
    В отличие от mmu.enabled это утверждение о железе («печатаем с держателя»),
    а не о состоянии эмуляции, поэтому переключать режим по нему можно сразу.

    None — объекта нет (обычный принтер, другая прошивка): решают старые сигналы.
    """
    r = payload.get("result", payload) or {}
    fh = (r.get("status", {}) or {}).get("filament_hub")
    if not isinstance(fh, dict) or "ext_spool" not in fh:
        return None
    hubs = fh.get("filament_hubs")
    return {
        "active": bool(fh.get("ext_spool")),
        "status": fh.get("ext_spool_status") or None,
        "filament_present": bool(fh.get("filament_present")),
        # null → ACE не подключена; список (даже пустой) → хаб на связи.
        "hub_attached": hubs is not None,
    }


def parse_dryer(payload: dict) -> dict | None:
    """Состояние сушки ACE (Rinkhals).

    Данные о сушке приходят из двух объектов и на один и тот же юнит:
      * mmu_machine.unit_N.dryer_* — статус и температуры, но остаток/длительность
        Rinkhals сюда не прокидывает (всегда 0);
      * filament_hub.filament_hubs[].dryer_status — здесь есть duration (в минутах)
        и remain_time (в СЕКУНДАХ).
    Мержим по номеру юнита, отдавая приоритет ненулевым значениям из filament_hub.

    Возвращает первый юнит с данными: status ("stop"/"drying"/"heater_err"),
    температуры, остаток в минутах, влажность. None — сушки нет (обычный принтер).
    """
    r = payload.get("result", payload) or {}
    status = r.get("status", {}) or {}
    units: dict[int, dict] = {}

    machine = status.get("mmu_machine", {}) or {}
    for key, u in machine.items():
        if not (isinstance(u, dict) and key.startswith("unit_")):
            continue
        if "dryer_status" not in u:
            continue
        uid = int(key.split("_")[1])
        units[uid] = {
            "unit": uid,
            "status": u.get("dryer_status", "stop"),
            "temp": u.get("dryer_temp", 0),
            "target_temp": u.get("dryer_target_temp", 0),
            "remaining_min": u.get("dryer_remaining", 0),
            "duration_min": u.get("dryer_duration", 0),
            "humidity": u.get("dryer_humidity", 0),
        }

    filament_hub = status.get("filament_hub", {}) or {}
    for hub in filament_hub.get("filament_hubs") or []:
        if not isinstance(hub, dict):
            continue
        dryer = hub.get("dryer_status") or {}
        if not isinstance(dryer, dict):
            continue
        uid = int(hub.get("id", 0) or 0)
        remain_sec = dryer.get("remaining_time", dryer.get("remain_time", 0)) or 0
        unit = units.setdefault(uid, {"unit": uid, "status": "stop"})
        # filament_hub — источник истины по остатку/длительности; для остальных
        # полей берём ненулевое значение, чтобы не затирать данные из mmu_machine.
        if dryer.get("status"):
            unit["status"] = dryer["status"]
        unit["temp"] = dryer.get("temp") or hub.get("temp") or unit.get("temp", 0)
        unit["target_temp"] = dryer.get("target_temp") or unit.get("target_temp", 0)
        unit["remaining_min"] = round(remain_sec / 60) or unit.get("remaining_min", 0)
        unit["duration_min"] = dryer.get("duration", 0) or unit.get("duration_min", 0)
        unit["humidity"] = dryer.get("humidity") or hub.get("humidity") or unit.get("humidity", 0)

    if not units:
        return None
    return sorted(units.values(), key=lambda x: (x["status"] != "drying", x["unit"]))[0]


# Подсветка камеры живёт не в Klipper, а среди power-устройств Moonraker
# (у Anycubic на Rinkhals это shell-девайс chamber_light). Имя задаёт прошивка,
# поэтому ищем по смыслу, а не по точному совпадению.
_LIGHT_WORDS = ("light", "led", "lamp", "lighting")


def parse_light(devices: list | None) -> dict | None:
    """Устройство подсветки среди /machine/device_power/devices.

    Возвращает {device, on, locked} — или None, если подсветкой управлять нельзя.
    При нескольких подходящих устройствах берём первое: подсветка камеры на
    домашних принтерах одна, а выбирать «правильную» без подсказки всё равно
    неоткуда.
    """
    for d in devices or []:
        if not isinstance(d, dict):
            continue
        name = str(d.get("device") or "")
        if not any(w in name.lower() for w in _LIGHT_WORDS):
            continue
        return {
            "device": name,
            "on": str(d.get("status") or "").lower() == "on",
            "locked": bool(d.get("locked_while_printing")),
        }
    return None


def detect_capabilities(gates: list | None, dryer: dict | None, *, online: bool = False) -> dict:
    """Возможности принтера, выведенные из живой телеметрии Moonraker.

    gates/dryer — уже распарсенные (parse_hub / parse_dryer). Пусто/None —
    значит соответствующей подсистемы у принтера сейчас нет.

    online=False (по умолчанию) — телеметрия только добавляет возможности:
    пустой ответ хаба неотличим от обрыва связи (get_hub_data глушит ошибки),
    поэтому снимать заявленные пресетом возможности по нему нельзя.

    online=True — связь с принтером подтверждена, и молчание хаба означает, что
    мультиподача физически отключена: тогда has_mmu/has_dryer снимаются. Ставить
    этот флаг должен вызывающий, убедившись в связи (и в стабильности ответа —
    см. app.services.feed_mode).
    """
    caps: dict = {}
    if gates:
        caps["has_mmu"] = True
        caps["mmu_slots"] = len(gates)
    elif online:
        caps["has_mmu"] = False
    if dryer is not None:
        caps["has_dryer"] = True
    elif online:
        caps["has_dryer"] = False
    return caps


def dryer_unit(dryer: dict | None, requested: int | None = None) -> int:
    if requested is not None:
        return requested
    if isinstance(dryer, dict) and dryer.get("unit") is not None:
        return int(dryer["unit"])
    return 0


def parse_totals(payload: dict) -> dict:
    """Статистика за всю жизнь принтера (/server/history/totals)."""
    t = (payload.get("result", payload) or {}).get("job_totals", {}) or {}
    return {
        "total_jobs": int(t.get("total_jobs") or 0),
        "total_print_time_sec": t.get("total_print_time"),
        "total_time_sec": t.get("total_time"),
        "total_filament_mm": t.get("total_filament_used"),
        "longest_print_sec": t.get("longest_print"),
    }


def _norm_material(s: str | None) -> str:
    """Верхний регистр без разделителей: 'PET-G' → 'PETG', 'PA (Nylon)' → 'PA(NYLON)'."""
    return re.sub(r"[\s_-]", "", (s or "").upper())


# Базовые материалы, длинные первыми: PETG не должен схлопнуться в PET, а
# PCTG — в PC. Вариант марки (ABS+, PLA+/Pro, PETG-CF) — тот же базовый
# материал, поэтому его достаточно срезать; а вот PET и PETG — разные.
_BASE_MATERIALS = tuple(
    sorted(
        ("PCTG", "PETG", "NYLON", "HIPS", "PLA", "PET", "ABS", "ASA",
         "TPU", "TPE", "PVA", "PC", "PA", "PP"),
        key=len,
        reverse=True,
    )
)

# Разные написания одного материала.
_MATERIAL_ALIASES = {"NYLON": "PA"}


def _base_material(s: str | None) -> str:
    """Базовый материал без варианта марки: 'ABS+' → 'ABS', 'PA (Nylon)' → 'PA'."""
    up = _norm_material(s)
    for base in _BASE_MATERIALS:
        if up.startswith(base):
            return _MATERIAL_ALIASES.get(base, base)
    # Материала нет в списке — срезаем хотя бы явные маркеры варианта.
    return re.split(r"[+/]", up)[0]


def _srgb_to_lab(color: str | None) -> tuple[float, float, float] | None:
    """sRGB (#rrggbb) → CIELAB (D65); None, если цвет не разобрать."""
    try:
        h = (color or "").lstrip("#")
        rgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    except Exception:
        return None

    def gamma(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    r, g, b = (gamma(c) for c in rgb)
    # линейный RGB → XYZ (D65), сразу нормируя на точку белого
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def _color_distance(a: str | None, b: str | None) -> float | None:
    """Перцептивное расстояние ΔE (CIE76); None, если один из цветов не задан.

    Считаем в Lab, а не в сыром RGB: евклидова дистанция по RGB не отражает
    восприятие. Два одинаково красных оттенка (#F40031 и #BB1E10) расходятся в
    ней на 72 — больше строгого порога, — хотя глазом это один цвет.
    """
    la, lb = _srgb_to_lab(a), _srgb_to_lab(b)
    if la is None or lb is None:
        return None
    return sum((x - y) ** 2 for x, y in zip(la, lb)) ** 0.5


# Граница «практически неразличимо» → «видно глазом». Отделить «тот же цвет»
# от «другого» порогом нельзя: в ΔE76 доминирует светлота, и синий/тёмно-синий
# (57) расходятся сильнее, чем красный/оранжевый (47). Это терпимо — за порогом
# начинается мягкий color_diff, а не предупреждение, так что цена ошибки низкая.
COLOR_MATCH_THRESHOLD = 30.0


def match_gate(gate: dict, spool_material: str | None, spool_color: str | None) -> str:
    """Сверка гейта хаба с катушкой из слота приложения.

    Возвращает вердикт:
      match      — материал и цвет согласуются;
      color_diff — материал тот же, разошёлся только оттенок. Мягкий вердикт:
                   на принтере цвет выбирают из грубой палитры вручную, поэтому
                   расхождение с точным цветом бренда — норма, а не проблема;
      mismatch   — принтер видит другой материал (или слот пуст, а катушка назначена);
      unassigned — филамент в принтере есть, катушка в приложении не привязана;
      empty      — и гейт пуст, и катушки нет.
    """
    has_spool = bool(spool_material or spool_color)
    if not gate.get("occupied"):
        return "mismatch" if has_spool else "empty"
    if not has_spool:
        return "unassigned"
    hub_m, sp_m = _base_material(gate.get("material")), _base_material(spool_material)
    material_ok = not hub_m or not sp_m or hub_m == sp_m
    if not material_ok:
        return "mismatch"
    dist = _color_distance(gate.get("color_hex"), spool_color)
    return "match" if dist is None or dist <= COLOR_MATCH_THRESHOLD else "color_diff"


def parse_history(payload: dict) -> list[dict]:
    r = payload.get("result", payload) or {}
    jobs = r.get("jobs", []) or []
    out = []
    for j in jobs:
        meta = j.get("metadata", {}) or {}
        out.append(
            {
                "job_id": j.get("job_id"),
                "filename": j.get("filename"),
                "status": j.get("status"),
                "start_time": j.get("start_time"),
                "end_time": j.get("end_time"),
                "print_duration_sec": j.get("print_duration"),
                "total_duration_sec": j.get("total_duration"),
                "filament_used_mm": j.get("filament_used"),
                "filament_total_g": meta.get("filament_weight_total"),
                "slicer": meta.get("slicer"),
            }
        )
    return out


def is_interrupted(job: dict) -> bool:
    """Печать оборвана (отмена вручную, ошибка, перезапуск хоста), а не доведена.

    Moonraker кладёт в status «cancelled», «error», «klippy_shutdown» и т.п.
    В отличие от completed, метаданные слайсера тут врут: они описывают всю
    печать целиком, а реально израсходована только часть.
    """
    status = job.get("status")
    return bool(status) and status not in ("completed", "in_progress")


def job_to_parsed(job: dict) -> dict:
    """Конвертирует задание из истории Moonraker в наш формат print job.

    Anycubic/Rinkhals кладут в metadata пофиловый расход в граммах
    (filament_weights), материалы и цвета — этого достаточно для списания.

    Для оборванных печатей веса слайсера игнорируются: единственная честная
    величина — filament_used, длина, реально выдавленная до остановки.
    """
    meta = job.get("metadata", {}) or {}
    interrupted = is_interrupted(job)
    weights = [] if interrupted else (meta.get("filament_weights") or [])
    types = [t.strip() for t in (meta.get("filament_type") or "").replace('"', "").split(";") if t.strip() != ""]
    colors = meta.get("filament_colors") or meta.get("extruder_colors") or []
    n = 0 if interrupted else max(len(weights), len(types), len(colors))
    tools = []
    for i in range(n):
        tools.append(
            {
                "tool_index": i,
                "material": types[i] if i < len(types) else None,
                "color_hex": colors[i] if i < len(colors) else None,
                "used_g": weights[i] if i < len(weights) else None,
                "used_mm": None,
                "density_g_cm3": None,
            }
        )
    total_mm = job.get("filament_used")
    if not tools and total_mm and float(total_mm) > 0:
        # Fallback: Moonraker не извлёк пофиловые веса (частый случай для
        # временных .3mf_temp-файлов) — но суммарная длина есть. Тот же путь для
        # оборванной печати: пофиловый расклад неизвестен, есть только общая
        # длина. Заводим одну строку расхода по длине; граммы посчитаются из
        # выбранной катушки при списании (диаметр × плотность).
        tools.append(
            {
                "tool_index": 0,
                "material": (types[0] if types else None) or _material_from_filename(job.get("filename")),
                "color_hex": colors[0] if colors else None,
                "used_g": None,
                "used_mm": total_mm,
                "density_g_cm3": None,
            }
        )
        n = 1

    est = meta.get("estimated_time")
    jid = job.get("job_id")
    return {
        "file_name": job.get("filename"),
        "file_hash": meta.get("uuid"),
        "moonraker_job_id": str(jid) if jid is not None else None,
        "slicer_name": meta.get("slicer"),
        "slicer_version": meta.get("slicer_version"),
        "diameter_mm": meta.get("nozzle_diameter"),
        "estimated_print_time_sec": int(est) if est else None,
        "filament_change_count": None,
        "tool_count": n,
        # Итог слайсера — для всей печати целиком; у оборванной он завысил бы
        # расход, поэтому там остаётся только фактическая длина.
        "total_filament_used_g": None if interrupted else meta.get("filament_weight_total"),
        "total_filament_used_mm": total_mm,
        "tools": tools,
    }


_MATERIALS = ("PLA+", "PETG", "PLA", "ABS", "ASA", "TPU", "PVA", "HIPS", "PC", "PA", "PP")


def _material_from_filename(name: str | None) -> str | None:
    """Материал из имени файла Anycubic (…_PLA_0.2_…). Только для подсказки."""
    up = (name or "").upper()
    for m in _MATERIALS:
        if f"_{m}_" in up or f"_{m}." in up:
            return m
    return None


class MoonrakerClient:
    def __init__(
        self,
        url: str,
        api_key: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        transport: httpx.BaseTransport | None = None,
    ):
        if not url:
            raise ValueError("Moonraker URL не задан")
        self.base = url.rstrip("/")
        self.headers = {"X-Api-Key": api_key} if api_key else {}
        self.timeout = timeout
        self._transport = transport  # для тестов (httpx.MockTransport)

    def _get(self, path: str) -> dict:
        with httpx.Client(
            timeout=self.timeout, headers=self.headers, transport=self._transport
        ) as client:
            resp = client.get(f"{self.base}{path}")
            resp.raise_for_status()
            return resp.json()

    def test_connection(self) -> dict:
        """Возвращает {ok, detail, info?} — никогда не бросает наружу."""
        try:
            info = parse_printer_info(self._get("/printer/info"))
            state = info.get("state") or "unknown"
            return {
                "ok": True,
                "detail": f"Подключено. Состояние: {state}",
                "info": info,
            }
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            hint = " (проверьте API-ключ)" if code in (401, 403) else ""
            return {"ok": False, "detail": f"HTTP {code}{hint}"}
        except httpx.HTTPError as e:
            return {"ok": False, "detail": f"Нет соединения: {type(e).__name__}"}
        except Exception as e:  # pragma: no cover
            return {"ok": False, "detail": f"Ошибка: {e}"}

    def get_status(self) -> dict:
        path = (
            "/printer/objects/query?print_stats&display_status&virtual_sdcard&heater_bed&extruder"
            "&fan&gcode_move&fan_generic%20box_fan&fan_generic%20air_filter_fan"
        )
        return parse_status(self._get(path))

    def get_hub(self) -> list[dict]:
        """Гейты ACE-хаба; пустой список, если хаба нет (обычный принтер)."""
        try:
            return parse_hub(self._get("/printer/objects/query?ota_filament_hub"))
        except Exception:
            return []

    def get_hub_data(self) -> dict:
        """Гейты, сушка, признак включённости хаба и внешняя катушка.

        Два запроса: ota_filament_hub (гейты и эмуляция mmu) и filament_hub —
        второй нужен и ради остатка сушки, и ради ext_spool (см. parse_ext_spool),
        поэтому берём его всегда, а не только при живой сушилке.
        """
        try:
            payload = self._get("/printer/objects/query?ota_filament_hub")
            gates = parse_hub(payload)
            dryer = parse_dryer(payload)
            enabled = parse_hub_enabled(payload)
            ext_spool = None
            try:
                raw_hub = self._get("/printer/objects/query?filament_hub")
                ext_spool = parse_ext_spool(raw_hub)
                raw_dryer = parse_dryer(raw_hub)
                if dryer is not None and raw_dryer and (
                    not dryer.get("remaining_min")
                    or raw_dryer.get("remaining_min")
                    or raw_dryer.get("duration_min")
                ):
                    for key in ("unit", "status"):
                        if raw_dryer.get(key) is not None:
                            dryer[key] = raw_dryer[key]
                    for key in ("temp", "target_temp", "remaining_min", "duration_min", "humidity"):
                        if raw_dryer.get(key):
                            dryer[key] = raw_dryer[key]
            except Exception:
                pass
            return {"gates": gates, "dryer": dryer, "enabled": enabled, "ext_spool": ext_spool}
        except Exception:
            # Связь с хабом не удалась — это не «хаба нет», поэтому enabled=None.
            return {"gates": [], "dryer": None, "enabled": None, "ext_spool": None}

    def get_light(self) -> dict | None:
        """Подсветка камеры, если принтер отдаёт её как power-устройство."""
        try:
            r = self._get("/machine/device_power/devices")
            return parse_light((r.get("result", r) or {}).get("devices"))
        except Exception:
            return None

    def _post(self, path: str, json_body: dict) -> dict:
        with httpx.Client(
            timeout=self.timeout, headers=self.headers, transport=self._transport
        ) as client:
            resp = client.post(f"{self.base}{path}", json=json_body)
            resp.raise_for_status()
            return resp.json()

    def start_drying(self, *, temp_c: int, duration_min: int, unit: int = 0) -> dict:
        """Включить сушку ACE (Rinkhals /server/filament_hub/start_drying)."""
        return self._post(
            "/server/filament_hub/start_drying",
            {"id": unit, "temp": temp_c, "duration": duration_min, "fan_speed": 0},
        )

    def stop_drying(self, *, unit: int = 0) -> dict:
        return self._post("/server/filament_hub/stop_drying", {"id": unit})

    def set_light(self, device: str, on: bool) -> dict:
        """Включить/выключить подсветку (Moonraker device_power)."""
        from urllib.parse import quote

        action = "on" if on else "off"
        return self._post(
            f"/machine/device_power/device?device={quote(device)}&action={action}", {}
        )

    def reset_print_state(self) -> dict:
        """Сбросить защёлкнутое состояние печати (Klipper SDCARD_RESET_FILE).

        Klipper держит print_stats.state=error от прерванной печати до старта
        новой; ручные операции с экрана его не сбрасывают. SDCARD_RESET_FILE
        вызывает print_stats.reset() → state возвращается в standby, а сообщение
        об ошибке очищается.
        """
        from urllib.parse import quote

        return self._post(f"/printer/gcode/script?script={quote('SDCARD_RESET_FILE')}", {})

    def get_totals(self) -> dict | None:
        try:
            return parse_totals(self._get("/server/history/totals"))
        except Exception:
            return None

    def get_system(self) -> dict:
        """Служебное: версии, CPU, ОС. Ошибки отдельных запросов не фатальны."""
        out: dict = {}
        try:
            info = parse_printer_info(self._get("/printer/info"))
            out["klipper_version"] = info.get("software_version")
            out["hostname"] = info.get("hostname")
        except Exception:
            pass
        try:
            r = self._get("/server/info").get("result", {})
            out["moonraker_version"] = r.get("moonraker_version")
        except Exception:
            pass
        try:
            si = (self._get("/machine/system_info").get("result", {}) or {}).get(
                "system_info", {}
            )
            cpu = si.get("cpu_info", {}) or {}
            out["cpu"] = cpu.get("cpu_desc") or cpu.get("model")
            out["os"] = (si.get("distribution", {}) or {}).get("name")
        except Exception:
            pass
        return out

    def list_history(self, limit: int = 20) -> list[dict]:
        return parse_history(self._get(f"/server/history/list?limit={limit}"))

    def history_raw(self, limit: int = 50) -> list[dict]:
        """Сырые задания истории (с metadata) — для импорта в списание."""
        r = self._get(f"/server/history/list?limit={limit}")
        return (r.get("result", r) or {}).get("jobs", []) or []
