from sqlalchemy.orm import Session

from app.models import AppSetting

# Разрешить списание катушки «в минус», если остатка не хватает.
ALLOW_NEGATIVE_KEY = "allow_negative_consumption"


def get_bool(db: Session, key: str, default: bool = False) -> bool:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    return bool(row.value.get("value", default)) if isinstance(row.value, dict) else bool(row.value)


def set_value(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value={"value": value}))
    else:
        row.value = {"value": value}
    db.commit()
