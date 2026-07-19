from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import User
from app.services import environment_watch, homeassistant

router = APIRouter(prefix="/environment", tags=["environment"])


class SensorReading(BaseModel):
    id: str
    name: str
    temperature: float | None
    humidity: float | None
    battery: float | None
    updated_at: str | None
    # Где показывать: рядом с местом хранения, с принтером или отдельной карточкой.
    bind_type: str | None
    bind_id: str | None
    # Заполнено, если Home Assistant не ответил — значения при этом пустые.
    error: str | None


class EnvironmentOut(BaseModel):
    sensors: list[SensorReading]
    # Порог подсветки — тот же, по которому уходят уведомления.
    humidity_alert_max_pct: float


@router.get("", response_model=EnvironmentOut)
def read_environment(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    """Текущие показания датчиков. Пустой список = датчики не настроены."""
    return EnvironmentOut(
        sensors=homeassistant.read_sensors(db),
        humidity_alert_max_pct=environment_watch.humidity_max(db),
    )
