import json
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import FilamentProfile, User
from app.schemas.filament_profile import (
    FilamentProfileCreate,
    FilamentProfileOut,
    FilamentProfileUpdate,
)
from app.services import backup_service

router = APIRouter(prefix="/filament-profiles", tags=["filament-profiles"])


def _visible(db: Session, user: User, profile_id: uuid.UUID) -> FilamentProfile:
    profile = db.get(FilamentProfile, profile_id)
    if profile is None or (
        profile.owner_user_id != user.id and not profile.is_public
    ):
        raise HTTPException(status_code=404, detail="Профиль не найден")
    return profile


@router.get("", response_model=list[FilamentProfileOut])
def list_profiles(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    material: str | None = None,
    brand: str | None = None,
    q: str | None = None,
):
    stmt = select(FilamentProfile).where(
        or_(
            FilamentProfile.owner_user_id == user.id,
            FilamentProfile.is_public.is_(True),
        )
    )
    if material:
        stmt = stmt.where(FilamentProfile.material == material)
    if brand:
        stmt = stmt.where(FilamentProfile.brand == brand)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                FilamentProfile.name.ilike(like),
                FilamentProfile.brand.ilike(like),
                FilamentProfile.color_name.ilike(like),
            )
        )
    return list(db.scalars(stmt.order_by(FilamentProfile.created_at)))


@router.post("", response_model=FilamentProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(
    data: FilamentProfileCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = FilamentProfile(owner_user_id=user.id, **data.model_dump())
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


# --- Этап 6: публичная база, экспорт, импорт ---
@router.get("/public", response_model=list[FilamentProfileOut])
def public_catalog(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    material: str | None = None,
    q: str | None = None,
):
    stmt = select(FilamentProfile).where(FilamentProfile.is_public.is_(True))
    if material:
        stmt = stmt.where(FilamentProfile.material == material)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(FilamentProfile.name.ilike(like), FilamentProfile.brand.ilike(like))
        )
    return list(db.scalars(stmt.order_by(FilamentProfile.brand, FilamentProfile.name)))


@router.get("/export")
def export_profiles(
    scope: str = "mine",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = backup_service.export_profiles(db, user, scope=scope)
    return JSONResponse(
        content={"version": 1, "filament_profiles": items},
        headers={"Content-Disposition": 'attachment; filename="profiles.json"'},
    )


@router.post("/import")
async def import_profiles(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        payload = json.loads(await file.read())
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Некорректный JSON")
    items = payload.get("filament_profiles") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="Ожидается список профилей")
    count = backup_service.import_profiles(db, user, items)
    return {"imported": count}


@router.post("/import-slicer", response_model=FilamentProfileOut, status_code=status.HTTP_201_CREATED)
async def import_slicer_profile(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Импорт нативного JSON-профиля филамента слайсера (Bambu Studio/Orca)."""
    from app.services.slicer_import import parse_slicer_filament

    try:
        payload = json.loads(await file.read())
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Некорректный JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Ожидается профиль слайсера (объект)")
    data = parse_slicer_filament(payload)
    profile = FilamentProfile(owner_user_id=user.id, is_public=False, **data)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/{profile_id}", response_model=FilamentProfileOut)
def get_profile(
    profile_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _visible(db, user, profile_id)


@router.patch("/{profile_id}", response_model=FilamentProfileOut)
def update_profile(
    profile_id: uuid.UUID,
    data: FilamentProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = db.get(FilamentProfile, profile_id)
    if profile is None or profile.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(profile, k, v)
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/{profile_id}/duplicate", response_model=FilamentProfileOut)
def duplicate_profile(
    profile_id: uuid.UUID,
    new_color: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Дублирует профиль. По умолчанию — точная копия (то же бренд/название/
    материал/цвет — различие профилей определяется цветом). С new_color=true
    очищает цвет, чтобы задать новый вариант того же филамента."""
    src = _visible(db, user, profile_id)
    fields = {
        c.name: getattr(src, c.name)
        for c in FilamentProfile.__table__.columns
        if c.name not in ("id", "owner_user_id", "created_at", "updated_at", "is_public")
    }
    if new_color:
        fields["color_name"] = None
        fields["color_hex"] = None
    clone = FilamentProfile(owner_user_id=user.id, is_public=False, **fields)
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return clone


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(
    profile_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = db.get(FilamentProfile, profile_id)
    if profile is None or profile.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    db.delete(profile)
    db.commit()
