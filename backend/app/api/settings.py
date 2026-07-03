from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.services import settings_service
from app.services.moonraker_sync import AUTO_CONSUME_KEY, AUTO_IMPORT_KEY

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsOut(BaseModel):
    allow_negative_consumption: bool
    moonraker_auto_import: bool
    moonraker_auto_consume: bool


class SettingsUpdate(BaseModel):
    allow_negative_consumption: bool | None = None
    moonraker_auto_import: bool | None = None
    moonraker_auto_consume: bool | None = None


def _current(db: Session) -> SettingsOut:
    return SettingsOut(
        allow_negative_consumption=settings_service.get_bool(
            db, settings_service.ALLOW_NEGATIVE_KEY
        ),
        moonraker_auto_import=settings_service.get_bool(db, AUTO_IMPORT_KEY, default=True),
        moonraker_auto_consume=settings_service.get_bool(db, AUTO_CONSUME_KEY, default=False),
    )


@router.get("", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    return _current(db)


@router.put("", response_model=SettingsOut)
def update_settings(
    data: SettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if data.allow_negative_consumption is not None:
        settings_service.set_value(
            db, settings_service.ALLOW_NEGATIVE_KEY, data.allow_negative_consumption
        )
    if data.moonraker_auto_import is not None:
        settings_service.set_value(db, AUTO_IMPORT_KEY, data.moonraker_auto_import)
    if data.moonraker_auto_consume is not None:
        settings_service.set_value(db, AUTO_CONSUME_KEY, data.moonraker_auto_consume)
    return _current(db)
