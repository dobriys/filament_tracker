"""Извлечение метаданных из gcode без сохранения самого файла.

Поддерживаются слайсеры семейства PrusaSlicer / SuperSlicer / OrcaSlicer /
BambuStudio (общий формат комментариев `; key = value`) и базово Cura.

Расход по инструментам берётся из строк вида:
    ; filament used [g] = 0.00, 5.09, 7.54, 39.97
    ; filament used [mm] = 0, 1680.2, 2490.1, 13200.5
Запятая-разделённые значения по индексу инструмента (Tool 0..N).
"""
import hashlib
import re

_KV_RE = re.compile(r"^[;\s]*([A-Za-z0-9_ \[\]\(\)/%\.\-]+?)\s*[:=]\s*(.+?)\s*$")
_TIME_TOKEN_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([dhms])")


def _to_float(s: str):
    try:
        return float(str(s).strip())
    except (ValueError, TypeError):
        return None


def _split_list(value: str) -> list[str]:
    # значения разделяют либо ';', либо ','
    sep = ";" if ";" in value else ","
    return [p.strip() for p in value.split(sep) if p.strip() != ""]


def _float_list(value: str) -> list[float]:
    out = []
    for p in _split_list(value):
        f = _to_float(p)
        out.append(f if f is not None else 0.0)
    return out


def _parse_time_to_sec(value: str):
    value = value.strip()
    # чистое число — секунды (Cura: ;TIME:3600)
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return int(float(value))
    units = {"d": 86400, "h": 3600, "m": 60, "s": 1}
    total = 0.0
    found = False
    for num, unit in _TIME_TOKEN_RE.findall(value.lower()):
        total += float(num) * units[unit]
        found = True
    return int(total) if found else None


def _detect_slicer(head: str):
    patterns = [
        (r"superslicer\s*([\d.]+)?", "SuperSlicer"),
        (r"prusaslicer\s*([\d.]+)?", "PrusaSlicer"),
        (r"orca[ _]?slicer\s*([\d.]+)?", "OrcaSlicer"),
        (r"bambu[ _]?studio\s*([\d.]+)?", "BambuStudio"),
        (r"cura[_a-z]*\s*([\d.]+)?", "Cura"),
        (r"ideamaker\s*([\d.]+)?", "ideaMaker"),
    ]
    low = head.lower()
    for rx, name in patterns:
        m = re.search(rx, low)
        if m:
            return name, (m.group(1) or None)
    return None, None


def parse_gcode(content: bytes | str, filename: str) -> dict:
    if isinstance(content, bytes):
        text = content.decode("utf-8", errors="replace")
    else:
        text = content

    file_hash = hashlib.sha256(
        content if isinstance(content, bytes) else content.encode("utf-8")
    ).hexdigest()

    meta: dict[str, str] = {}
    head_lines: list[str] = []
    toolchanges = 0
    tool_select_re = re.compile(r"^T(\d+)\b")
    m600_re = re.compile(r"^M600\b")

    for i, raw in enumerate(text.splitlines()):
        line = raw.strip()
        if i < 60:
            head_lines.append(line)
        if not line:
            continue
        if line.startswith(";"):
            m = _KV_RE.match(line)
            if m:
                key = m.group(1).strip().lower()
                meta[key] = m.group(2).strip()
        else:
            # команды без комментария — считаем смены филамента
            if m600_re.match(line):
                toolchanges += 1
            elif tool_select_re.match(line):
                toolchanges += 1

    def get(*keys):
        for k in keys:
            if k in meta:
                return meta[k]
        return None

    slicer_name, slicer_version = _detect_slicer("\n".join(head_lines))

    used_g = _float_list(get("filament used [g]", "total filament used [g]") or "")
    used_mm = _float_list(get("filament used [mm]") or "")
    materials = _split_list(get("filament_type", "filament type") or "")
    colors = _split_list(get("filament_colour", "filament_color", "extruder_colour") or "")
    diameters = _float_list(get("filament_diameter") or "")
    densities = _float_list(get("filament_density") or "")

    n_tools = max(len(used_g), len(used_mm), len(materials), len(colors)) or 0

    tools = []
    for idx in range(n_tools):
        tools.append(
            {
                "tool_index": idx,
                "material": materials[idx] if idx < len(materials) else None,
                "color_hex": colors[idx] if idx < len(colors) else None,
                "used_g": used_g[idx] if idx < len(used_g) else None,
                "used_mm": used_mm[idx] if idx < len(used_mm) else None,
                "density_g_cm3": densities[idx] if idx < len(densities) else None,
            }
        )

    total_g = _to_float(get("total filament used [g]"))
    if total_g is None and used_g:
        total_g = round(sum(used_g), 2)
    total_mm = _to_float(get("total filament used [mm]"))
    if total_mm is None and used_mm:
        total_mm = round(sum(used_mm), 2)

    est_time = None
    for tk in (
        "estimated printing time (normal mode)",
        "estimated printing time",
        "total estimated time",
        "model printing time",
        "time",
    ):
        if tk in meta:
            est_time = _parse_time_to_sec(meta[tk])
            if est_time:
                break

    diameter = diameters[0] if diameters else _to_float(get("filament_diameter")) or 1.75

    return {
        "file_name": filename,
        "file_hash": file_hash,
        "slicer_name": slicer_name,
        "slicer_version": slicer_version,
        "diameter_mm": diameter,
        "estimated_print_time_sec": est_time,
        "filament_change_count": toolchanges or None,
        "tool_count": n_tools,
        "total_filament_used_g": total_g,
        "total_filament_used_mm": total_mm,
        "tools": tools,
    }
