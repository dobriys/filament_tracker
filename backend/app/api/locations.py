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


def _descendant_ids(db: Session, user: User, root_id: uuid.UUID) -> set[uuid.UUID]:
    """id всех потомков места (без самого места) — для защиты от циклов."""
    children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for lid, pid in db.execute(
        select(Location.id, Location.parent_id).where(
            Location.owner_user_id == user.id
        )
    ):
        children.setdefault(pid, []).append(lid)
    result: set[uuid.UUID] = set()
    stack = list(children.get(root_id, []))
    while stack:
        cur = stack.pop()
        if cur in result:
            continue
        result.add(cur)
        stack.extend(children.get(cur, []))
    return result


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
    if data.parent_id is not None:
        _own(db, user, data.parent_id)  # родитель должен принадлежать пользователю
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
    fields = data.model_dump(exclude_unset=True)
    if "parent_id" in fields and fields["parent_id"] is not None:
        new_parent = fields["parent_id"]
        if new_parent == location_id or new_parent in _descendant_ids(
            db, user, location_id
        ):
            raise HTTPException(
                status_code=400,
                detail="Место нельзя вложить в себя или в свой вложенный узел",
            )
        _own(db, user, new_parent)  # родитель должен принадлежать пользователю
    for k, v in fields.items():
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
    has_child = db.scalar(
        select(Location.id).where(Location.parent_id == location_id).limit(1)
    )
    if has_child is not None:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить место, у которого есть вложенные — сначала уберите их",
        )
    db.delete(loc)
    db.commit()
