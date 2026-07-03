from app.services.slicer_import import parse_slicer_filament

# Фрагмент реального профиля LIDER-3D PETG (Bambu/Orca, значения — массивы).
SAMPLE = {
    "filament_type": ["PETG"],
    "filament_settings_id": ["Lider-3D PETG"],
    "filament_vendor": ["Generic"],
    "filament_diameter": ["1.75"],
    "filament_density": ["1.27"],
    "nozzle_temperature_range_low": ["220"],
    "nozzle_temperature_range_high": ["260"],
    "cool_plate_temp": ["60"],
    "hot_plate_temp": ["80"],
    "textured_plate_temp": ["80"],
    "supertack_plate_temp": ["70"],
    "eng_plate_temp": ["0"],
    "filament_max_volumetric_speed": ["10"],
    "filament_flow_ratio": ["1"],
    "pressure_advance": ["0.02"],
    "fan_max_speed": ["100"],
    "fan_min_speed": ["20"],
    "overhang_fan_speed": ["100"],
    "close_fan_the_first_x_layers": ["3"],
    "chamber_temperature": ["0"],
    "temperature_vitrification": ["70"],
}


def test_parse_lider_petg():
    d = parse_slicer_filament(SAMPLE)
    assert d["brand"] == "Lider-3D"
    assert d["name"] == "PETG"
    assert d["material"] == "PETG"
    assert d["diameter_mm"] == 1.75
    assert d["density_g_cm3"] == 1.27
    assert d["nozzle_temp_min"] == 220 and d["nozzle_temp_max"] == 260
    assert d["bed_temp_min"] == 60 and d["bed_temp_max"] == 80
    assert d["max_volumetric_speed"] == 10 and d["flow_ratio"] == 1.0
    assert d["pressure_advance"] == 0.02 and d["fan_percent"] == 100
    s = d["specs"]
    assert s["fan_min"] == 20 and s["bridge_fan"] == 100
    assert s["fan_disable_layers"] == "3" and s["softening_temp"] == 70
    assert "chamber_temp" not in s  # был 0
    assert s["build_plates"] == ["Cool Plate", "Cool Plate SuperTack", "Smooth PEI", "Textured PEI"]


def test_vendor_kept_when_not_generic():
    d = parse_slicer_filament({"filament_type": ["PLA"], "name": "X", "filament_vendor": ["Polymaker"]})
    assert d["brand"] == "Polymaker"
