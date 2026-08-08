from sqlalchemy.orm import Session

from app.models import AppSetting

# Разрешить списание катушки «в минус», если остатка не хватает.
ALLOW_NEGATIVE_KEY = "allow_negative_consumption"

# «Катушка заканчивается»: порог считается от ёмкости самой катушки.
#
# Одним числом это не закрыть — дома встречаются и пробники 250 г, и бухты 3 кг,
# то есть разброс на порядок. Абсолютные 100 г на пробнике — это 40% и сигнал
# почти сразу после вскрытия; чистый процент на 5 кг даёт 500 г, а это ещё часов
# двенадцать печати. Поэтому доля от катушки, подрезанная с двух сторон:
#
#   порог = min(max(ёмкость × pct, min_g), max_g)
#
# Нижний зажим — про физику: типичная бытовая печать 20–60 г, а последние 20–30 г
# у сердечника часто не выбрать (филамент там изогнут). Верхний — про смысл
# сигнала: «пора готовить замену», а не «осталось 10%».
SPOOL_LOW_PCT_KEY = "spool_low_pct"
SPOOL_LOW_MIN_KEY = "spool_low_min_g"
SPOOL_LOW_MAX_KEY = "spool_low_max_g"
SPOOL_LOW_PCT_DEFAULT = 10.0
SPOOL_LOW_MIN_DEFAULT = 50.0
SPOOL_LOW_MAX_DEFAULT = 200.0

# Катушка без указанной ёмкости (початая, импорт) считается килограммовой —
# это стандарт настольной печати, и на нём правило даёт привычные 100 г.
DEFAULT_CAPACITY_G = 1000.0

# Прежний единый порог в граммах. Оставлен только ради тех, кто успел задать
# его вручную: при первом чтении он превращается в жёсткие зажимы (см. low_config).
LEGACY_SPOOL_LOW_KEY = "spool_low_threshold_g"


def get_bool(db: Session, key: str, default: bool = False) -> bool:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    return bool(row.value.get("value", default)) if isinstance(row.value, dict) else bool(row.value)


def get_value(db: Session, key: str, default=None):
    """Произвольное значение настройки (строка, число, словарь)."""
    row = db.get(AppSetting, key)
    if row is None:
        return default
    if isinstance(row.value, dict) and "value" in row.value:
        v = row.value["value"]
        return default if v is None else v
    return row.value


def _num(db: Session, key: str, default: float) -> float:
    try:
        return float(get_value(db, key, default))
    except (TypeError, ValueError):
        return default


def low_config(db: Session) -> dict:
    """Настройки порога «катушка заканчивается»: {pct, min_g, max_g}.

    Если пользователь успел задать старый единый порог в граммах, а новых
    настроек ещё нет, — уважаем его выбор: оба зажима равны этому числу, то есть
    порог остаётся прежним фиксированным, пока его не поменяют осознанно.
    """
    legacy = get_value(db, LEGACY_SPOOL_LOW_KEY)
    unset = get_value(db, SPOOL_LOW_MAX_KEY) is None
    if legacy is not None and unset:
        try:
            fixed = float(legacy)
            return {"pct": 0.0, "min_g": fixed, "max_g": fixed}
        except (TypeError, ValueError):
            pass
    return {
        "pct": _num(db, SPOOL_LOW_PCT_KEY, SPOOL_LOW_PCT_DEFAULT),
        "min_g": _num(db, SPOOL_LOW_MIN_KEY, SPOOL_LOW_MIN_DEFAULT),
        "max_g": _num(db, SPOOL_LOW_MAX_KEY, SPOOL_LOW_MAX_DEFAULT),
    }


def low_threshold_for(capacity_g: float | None, cfg: dict) -> float:
    """Порог в граммах для катушки такой ёмкости. Чистая функция.

    Ёмкость — вес филамента у полной катушки (initial_filament_weight_g).
    Пусто → считаем катушку килограммовой (DEFAULT_CAPACITY_G).
    """
    capacity = float(capacity_g or 0) or DEFAULT_CAPACITY_G
    by_pct = capacity * float(cfg.get("pct") or 0) / 100
    low = float(cfg.get("min_g") or 0)
    high = float(cfg.get("max_g") or 0)
    if high < low:  # перепутанные местами зажимы не должны схлопывать порог в 0
        low, high = high, low
    return min(max(by_pct, low), high)


def spool_low_threshold(db: Session, capacity_g: float | None = None) -> float:
    """Порог «катушка заканчивается» в граммах для катушки такой ёмкости."""
    return low_threshold_for(capacity_g, low_config(db))


def set_value(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value={"value": value}))
    else:
        row.value = {"value": value}
    db.commit()
