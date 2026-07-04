"""Курируемый каталог пресетов принтеров.

Не полная база всех моделей, а короткий список популярных конфигураций для
префилла при заведении принтера: тип интеграции, число слотов мультиподачи и
возможности (capabilities), которые драйвят визуал карточки. Расширяется PR-ами.

capabilities:
  tool_count  — число экструдеров/тулов
  has_mmu     — есть система мультиподачи
  mmu_slots   — число слотов (гейтов)
  mmu_name    — название системы (для лейблов), необязательно
  has_dryer   — активная сушилка
  has_chamber — отапливаемая камера
  controls    — что умеем не только читать, но и слать (напр. dryer_start_stop)
"""

PRESETS: list[dict] = [
    {
        "key": "anycubic-kobra-s1-combo",
        "brand": "Anycubic",
        "model": "Kobra S1 Combo",
        "integration_type": "moonraker",
        "capabilities": {
            "tool_count": 4,
            "has_mmu": True,
            "mmu_slots": 4,
            "mmu_name": "ACE Pro",
            "has_dryer": True,
            "has_chamber": True,
            "controls": ["dryer_start_stop"],
        },
    },
    {
        "key": "anycubic-kobra-s1",
        "brand": "Anycubic",
        "model": "Kobra S1",
        "integration_type": "moonraker",
        "capabilities": {"tool_count": 1, "has_mmu": False, "has_dryer": False, "has_chamber": True},
    },
    {
        "key": "anycubic-kobra-3-combo",
        "brand": "Anycubic",
        "model": "Kobra 3 Combo",
        "integration_type": "moonraker",
        "capabilities": {
            "tool_count": 4,
            "has_mmu": True,
            "mmu_slots": 4,
            "mmu_name": "ACE",
            "has_dryer": False,
        },
    },
    {
        "key": "generic-klipper",
        "brand": None,
        "model": "Klipper / Moonraker",
        "integration_type": "moonraker",
        # Пусто — возможности определим автоматически из телеметрии.
        "capabilities": {},
    },
    {
        "key": "generic-manual",
        "brand": None,
        "model": "Другой принтер (вручную)",
        "integration_type": "manual",
        "capabilities": {},
    },
]

_BY_KEY = {p["key"]: p for p in PRESETS}


def get_preset(key: str | None) -> dict | None:
    return _BY_KEY.get(key) if key else None
