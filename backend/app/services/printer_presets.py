"""Курируемый каталог пресетов принтеров.

Не полная база всех моделей, а список Wi-Fi Klipper/Moonraker-принтеров, с которыми
приложение совместимо (штатно, через форк-стек или после root/overlay вроде Rinkhals).
Пресет префилит при заведении принтера тип интеграции, число слотов и возможности
(capabilities), которые драйвят визуал карточки. Расширяется PR-ами.

capabilities:
  tool_count  — число экструдеров/тулов
  has_mmu     — есть система мультиподачи
  mmu_slots   — число слотов (гейтов)
  mmu_name    — название системы (для лейблов), необязательно
  has_dryer   — активная сушилка
  has_chamber — закрытая/отапливаемая камера
  controls    — что умеем не только читать, но и слать (напр. dryer_start_stop)

note — короткая подсказка (объём печати + нюанс доступа), показывается при выборе.
"""

_ACE = {"has_mmu": True, "mmu_slots": 4, "mmu_name": "ACE", "has_dryer": False, "tool_count": 4}
_ACE_PRO = {"has_mmu": True, "mmu_slots": 4, "mmu_name": "ACE Pro", "has_dryer": True,
            "has_chamber": True, "tool_count": 4, "controls": ["dryer_start_stop"]}


def _preset(brand, model, caps, note, key=None, integration="moonraker"):
    if key is None:
        key = "-".join(
            f"{brand} {model}".lower().replace("/", " ").replace("+", "plus").split()
        )
    return {"key": key, "brand": brand, "model": model,
            "integration_type": integration, "capabilities": caps, "note": note}


PRESETS: list[dict] = [
    # --- Anycubic (Kobra OS; Moonraker через overlay Rinkhals) ---
    _preset("Anycubic", "Kobra 2 Pro", {}, "220×220×250 · через Rinkhals"),
    _preset("Anycubic", "Kobra 3", {}, "250×250×260 · через Rinkhals"),
    _preset("Anycubic", "Kobra 3 Combo", dict(_ACE), "250×250×260 · ACE · через Rinkhals",
            key="anycubic-kobra-3-combo"),
    _preset("Anycubic", "Kobra 3 V2", {}, "255×255×260 · через Rinkhals"),
    _preset("Anycubic", "Kobra 3 V2 Combo", dict(_ACE), "255×255×260 · ACE · через Rinkhals"),
    _preset("Anycubic", "Kobra 3 Max", {}, "420×420×500 · через Rinkhals"),
    _preset("Anycubic", "Kobra 3 Max Combo", dict(_ACE), "420×420×500 · ACE · через Rinkhals"),
    _preset("Anycubic", "Kobra S1", {"has_chamber": True},
            "250×250×250 · закрытая · через Rinkhals", key="anycubic-kobra-s1"),
    _preset("Anycubic", "Kobra S1 Combo", dict(_ACE_PRO),
            "250×250×250 · ACE Pro · через Rinkhals", key="anycubic-kobra-s1-combo"),
    _preset("Anycubic", "Kobra S1 Max", {"has_chamber": True},
            "350×350×350 · закрытая · через Rinkhals"),
    _preset("Anycubic", "Kobra S1 Max Combo", dict(_ACE_PRO),
            "350×350×350 · ACE Pro · через Rinkhals"),

    # --- Artillery ---
    _preset("Artillery", "Sidewinder X4 Pro", {}, "240×240×260 · Fluidd"),
    _preset("Artillery", "Sidewinder X4 Plus", {}, "300×300×400 · Fluidd"),

    # --- BIQU / BigTreeTech ---
    _preset("BIQU", "Hurakan", {}, "220×220×270 · Mainsail из коробки"),

    # --- Comgrow ---
    _preset("Comgrow", "T500", {}, "500×500×500 · Mainsail/Fluidd"),

    # --- Creality (обычно нужен root / Helper Script) ---
    _preset("Creality", "K1", {"has_chamber": True}, "220×220×250 · закрытая · нужен root"),
    _preset("Creality", "K1C", {"has_chamber": True}, "220×220×250 · закрытая · нужен root"),
    _preset("Creality", "K1 Max", {"has_chamber": True}, "300×300×300 · закрытая · нужен root"),
    _preset("Creality", "K2 Plus", {"has_chamber": True}, "350×350×350 · закрытая · доступ ограничен"),
    _preset("Creality", "Ender-3 V3 KE", {}, "220×220×240 · Moonraker зависит от прошивки"),
    _preset("Creality", "Ender-3 V3 Plus", {}, "300×300×330 · Moonraker зависит от прошивки"),
    _preset("Creality", "CR-10 SE", {}, "220×220×265 · нужен root"),

    # --- ELEGOO (форк-стек) ---
    _preset("ELEGOO", "Neptune 4 Plus", {}, "320×320×385 · Fluidd (форк ELEGOO)"),
    _preset("ELEGOO", "Neptune 4 Max", {}, "420×420×480 · Fluidd (форк ELEGOO)"),

    # --- FLSUN (дельты) ---
    _preset("FLSUN", "V400", {}, "Ø300×410 · дельта · Klipper Speeder Pad"),
    _preset("FLSUN", "V400 Max", {}, "Ø400×400 · дельта"),
    _preset("FLSUN", "S1", {"has_chamber": True}, "Ø320×430 · дельта закрытая"),
    _preset("FLSUN", "S1 Pro", {"has_chamber": True}, "Ø320×430 · дельта закрытая"),
    _preset("FLSUN", "T1", {}, "Ø260×330 · дельта"),
    _preset("FLSUN", "T1 Pro", {}, "Ø260×330 · дельта"),
    _preset("FLSUN", "T1 Max", {}, "Ø320×330 · дельта"),

    # --- Flashforge (неофициальный Klipper-мод) ---
    _preset("Flashforge", "Adventurer 5M", {}, "220×220×220 · неофициальный Klipper-мод"),
    _preset("Flashforge", "Adventurer 5M Pro", {"has_chamber": True},
            "220×220×220 · закрытая · неофициальный Klipper-мод"),

    # --- Kingroon ---
    _preset("Kingroon", "KP3S Pro V2", {}, "200×200×200 · Fluidd/Mainsail"),
    _preset("Kingroon", "KLP1", {"has_chamber": True}, "210×210×210 · закрытая · CoreXY"),

    # --- LulzBot ---
    _preset("LulzBot", "Mini 3", {}, "160×160×180 · Mainsail на борту"),

    # --- Prusa ---
    _preset("Prusa", "Pro HT90", {"has_chamber": True},
            "Ø300×400 · промышленная дельта · возможна HTTP-аутентификация"),

    # --- QIDI (CoreXY, закрытые; возможен API-ключ) ---
    _preset("QIDI", "Q1 Pro", {"has_chamber": True}, "245×245×240 · закрытая · возможен API-ключ"),
    _preset("QIDI", "X-Smart 3", {"has_chamber": True}, "175×180×170 · закрытая"),
    _preset("QIDI", "X-Plus 3", {"has_chamber": True}, "280×280×270 · закрытая"),
    _preset("QIDI", "X-Max 3", {"has_chamber": True}, "325×325×315 · закрытая"),
    _preset("QIDI", "Plus4", {"has_chamber": True}, "305×305×280 · закрытая"),
    _preset("QIDI", "Max4", {"has_chamber": True}, "325×325×315 · закрытая"),

    # --- Sovol (klipperized firmware) ---
    _preset("Sovol", "SV07", {}, "220×220×250 · Mainsail"),
    _preset("Sovol", "SV07 Plus", {}, "300×300×350 · Mainsail"),
    _preset("Sovol", "SV08", {}, "350×350×345 · CoreXY (Voron-style)"),
    _preset("Sovol", "SV08 Max", {}, "500×500×500 · CoreXY"),
    _preset("Sovol", "SV06 ACE", {}, "220×220×250 · Mainsail"),
    _preset("Sovol", "SV06 Plus ACE", {}, "300×300×340 · Wi-Fi только WPA2"),

    # --- Универсальные ---
    _preset(None, "Klipper / Moonraker", {},
            "Любой Klipper-принтер — возможности определятся сами", key="generic-klipper"),
    _preset(None, "Другой принтер (вручную)", {},
            "Без live-связи — только склад и списание вручную",
            key="generic-manual", integration="manual"),
]

_BY_KEY = {p["key"]: p for p in PRESETS}


def get_preset(key: str | None) -> dict | None:
    return _BY_KEY.get(key) if key else None
