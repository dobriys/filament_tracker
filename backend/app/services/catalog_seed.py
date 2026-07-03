"""Стартовый каталог популярных филаментов (публичные профили).

Значения — типовые опубликованные диапазоны производителей, стартовая точка для
предзаполнения катушки; пользователь может править. LIDER-3D PLA+/Pro взят с
карточки 3dfilamentprofiles.com. Сидер идемпотентен: добавляет только то, чего
ещё нет (по бренду+названию).
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FilamentProfile

AMS_ALL = ["AMS Lite (L)", "AMS (A)", "AMS 2 Pro (A2)", "AMS HT (HT)"]
PLATES_PLA = ["Smooth PEI", "Textured PEI", "Cool Plate"]
PLATES_HOT = ["Smooth PEI", "Textured PEI", "Engineering Plate"]

# brand, name, material, n_min, n_max, b_min, b_max, density, flow, maxvol, specs
CATALOG = [
    ("LIDER-3D", "PLA+/Pro Basic", "PLA+/Pro", 210, 230, 45, 60, 1.24, 0.96, 20,
     {"material_type": "Basic", "softening_temp": 53, "drying_temp": 50, "dry_time_hours": 4,
      "ams_compatibility": AMS_ALL, "build_plates": PLATES_PLA}),
    ("Bambu Lab", "PLA Basic", "PLA", 190, 230, 35, 45, 1.24, 0.98, 21,
     {"material_type": "Basic", "drying_temp": 55, "dry_time_hours": 8,
      "ams_compatibility": AMS_ALL, "build_plates": PLATES_PLA}),
    ("Bambu Lab", "PLA Matte", "PLA", 190, 230, 35, 45, 1.27, 0.98, 18,
     {"material_type": "Matte", "ams_compatibility": AMS_ALL, "build_plates": PLATES_PLA}),
    ("Bambu Lab", "PETG HF", "PETG", 230, 260, 70, 80, 1.27, 0.95, 20,
     {"drying_temp": 65, "dry_time_hours": 8, "ams_compatibility": AMS_ALL, "build_plates": PLATES_HOT}),
    ("Bambu Lab", "ABS", "ABS", 240, 270, 90, 100, 1.05, 0.95, 18,
     {"chamber_temp": 50, "drying_temp": 80, "dry_time_hours": 4, "build_plates": PLATES_HOT}),
    ("Prusament", "PLA", "PLA", 210, 220, 55, 60, 1.24, 0.95, 15,
     {"material_type": "Prusament", "build_plates": PLATES_PLA}),
    ("Prusament", "PETG", "PETG", 240, 250, 80, 90, 1.27, 0.95, 15, {"drying_temp": 60}),
    ("eSUN", "PLA+", "PLA+/Pro", 205, 225, 55, 60, 1.24, 0.97, 16,
     {"drying_temp": 45, "dry_time_hours": 6, "build_plates": PLATES_PLA}),
    ("eSUN", "PETG", "PETG", 230, 250, 75, 90, 1.27, 0.95, 14, {"drying_temp": 65}),
    ("Polymaker", "PolyTerra PLA", "PLA", 190, 230, 25, 60, 1.31, 0.98, 15,
     {"material_type": "PolyTerra", "build_plates": PLATES_PLA}),
    ("Polymaker", "PolyLite ASA", "ASA", 240, 260, 90, 100, 1.07, 0.95, 15, {"chamber_temp": 50}),
    ("Overture", "PLA", "PLA", 190, 220, 55, 60, 1.24, 0.98, 14, {"build_plates": PLATES_PLA}),
    ("Overture", "PETG", "PETG", 230, 250, 80, 80, 1.27, 0.95, 12, {"drying_temp": 65}),
    ("SUNLU", "PLA+", "PLA+/Pro", 205, 225, 50, 60, 1.24, 0.97, 15, {}),
    ("SUNLU", "PETG", "PETG", 220, 250, 70, 80, 1.27, 0.95, 12, {}),
    ("Creality", "Hyper PLA", "PLA", 210, 230, 45, 60, 1.24, 0.98, 25,
     {"material_type": "High Speed", "build_plates": PLATES_PLA}),
    ("Hatchbox", "PLA", "PLA", 180, 220, 50, 60, 1.24, 0.98, 12, {}),
    ("ELEGOO", "PLA+", "PLA+/Pro", 205, 225, 55, 60, 1.24, 0.97, 16, {}),
    ("Anycubic", "PLA", "PLA", 190, 230, 55, 60, 1.24, 0.98, 15, {}),
    ("Bambu Lab", "TPU 95A HF", "TPU", 220, 240, 35, 45, 1.22, 0.95, 10, {}),
]


def seed_catalog(db: Session) -> int:
    # Идентичность профиля — бренд+название+материал+цвет (различие по цвету).
    existing = {
        (p.brand, p.name, p.material, p.color_name)
        for p in db.scalars(select(FilamentProfile).where(FilamentProfile.is_public.is_(True)))
    }
    added = 0
    for brand, name, material, nmin, nmax, bmin, bmax, density, flow, maxvol, specs in CATALOG:
        if (brand, name, material, None) in existing:
            continue
        db.add(
            FilamentProfile(
                owner_user_id=None,
                brand=brand,
                name=name,
                material=material,
                diameter_mm=1.75,
                density_g_cm3=density,
                nozzle_temp_min=nmin,
                nozzle_temp_max=nmax,
                bed_temp_min=bmin,
                bed_temp_max=bmax,
                flow_ratio=flow,
                max_volumetric_speed=maxvol,
                fan_percent=100,
                is_public=True,
                source_name="Каталог (стандарт)",
                specs=specs or None,
            )
        )
        added += 1
    if added:
        db.commit()
    return added
