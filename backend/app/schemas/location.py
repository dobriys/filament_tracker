import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LocationBase(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None
    description: str | None = None


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: str | None = None
    parent_id: uuid.UUID | None = None
    description: str | None = None


class LocationOut(LocationBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID
    created_at: datetime
