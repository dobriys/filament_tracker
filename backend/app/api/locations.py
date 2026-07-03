import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import Location, User
from app.schemas.location import LocationCreate, LocationOut, LocationUpdate

router = APIRouter(prefix="/locations", tags=["locations"])


def _own(db: Session, user: User, location_id: uuid.UUID) -> Location:
    loc = db.get(Location, location_id)
    if loc is None or loc.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Место хранения не найдено")
    return loc


@router.get("", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return list(
        db.scalars(
            select(Location)
            .where(Location.owner_user_id == user.id)
            .order_by(Location.name)
        )
    )


@router.post("", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
def create_location(
    data: LocationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loc = Location(owner_user_id=user.id, **data.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


@router.get("/{location_id}", response_model=LocationOut)
def get_location(
    location_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _own(db, user, location_id)


@router.patch("/{location_id}", response_model=LocationOut)
def update_location(
    location_id: uuid.UUID,
    data: LocationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loc = _own(db, user, location_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(loc, k, v)
    db.commit()
    db.refresh(loc)
    return loc


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(
    location_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loc = _own(db, user, location_id)
    db.delete(loc)
    db.commit()
