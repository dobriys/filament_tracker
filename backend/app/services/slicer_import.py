"""Разбор нативного JSON-профиля филамента слайсера (Bambu Studio / OrcaSlicer)
в наши поля профиля. Значения в таких файлах — массивы из одной строки.
"""


def _v(obj: dict, key: str):
    v = obj.get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v):
    n = _num(v)
    return int(n) if n is not None else None


PLATE_KEYS = [
    ("cool_plate_temp", "Cool Plate"),
    ("supertack_plate_temp", "Cool Plate SuperTack"),
    ("hot_plate_temp", "Smooth PEI"),
    ("textured_plate_temp", "Textured PEI"),
    ("eng_plate_temp", "Engineering Plate"),
]


def parse_slicer_filament(obj: dict) -> dict:
    material = _v(obj, "filament_type") or "PLA"
    name = _v(obj, "filament_settings_id") or obj.get("name") or "Импортированный профиль"

    vendor = _v(obj, "filament_vendor")
    brand = vendor if vendor and vendor.strip().lower() != "generic" else None
    # Если бренд не указан, пробуем выделить его из названия ("Lider-3D PETG").
    if brand is None:
        parts = name.split()
        if len(parts) >= 2 and parts[-1].upper() == material.upper():
            brand = " ".join(parts[:-1])
            name = material

    cool = _num(_v(obj, "cool_plate_temp"))
    hot = _num(_v(obj, "hot_plate_temp"))
    textured = _num(_v(obj, "textured_plate_temp"))
    eng = _num(_v(obj, "eng_plate_temp"))
    bed_max = hot or textured or eng or cool
    bed_min = cool or bed_max

    specs: dict = {}
    fan_min = _num(_v(obj, "fan_min_speed"))
    if fan_min:
        specs["fan_min"] = fan_min
    bridge = _num(_v(obj, "overhang_fan_speed"))
    if bridge and bridge > 0:
        specs["bridge_fan"] = bridge
    disable_layers = _v(obj, "close_fan_the_first_x_layers")
    if disable_layers and str(disable_layers) not in ("0", "None"):
        specs["fan_disable_layers"] = str(disable_layers)
    chamber = _num(_v(obj, "chamber_temperature"))
    if chamber:
        specs["chamber_temp"] = chamber
    softening = _num(_v(obj, "temperature_vitrification"))
    if softening:
        specs["softening_temp"] = softening
    plates = [label for key, label in PLATE_KEYS if _num(_v(obj, key))]
    if plates:
        specs["build_plates"] = plates

    return {
        "brand": brand,
        "name": name,
        "material": material,
        "diameter_mm": _num(_v(obj, "filament_diameter")),
        "density_g_cm3": _num(_v(obj, "filament_density")),
        "nozzle_temp_min": _int(_v(obj, "nozzle_temperature_range_low")),
        "nozzle_temp_max": _int(_v(obj, "nozzle_temperature_range_high")),
        "bed_temp_min": int(bed_min) if bed_min else None,
        "bed_temp_max": int(bed_max) if bed_max else None,
        "flow_ratio": _num(_v(obj, "filament_flow_ratio")),
        "max_volumetric_speed": _num(_v(obj, "filament_max_volumetric_speed")),
        "pressure_advance": _num(_v(obj, "pressure_advance")),
        "fan_percent": _int(_v(obj, "fan_max_speed")),
        "notes": (_v(obj, "filament_notes") or None) or None,
        "specs": specs or None,
    }
