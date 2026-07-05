"""Каталог филамента из SpoolmanDB — поиск для автозаполнения + обновление снапшота."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.services import spoolmandb

router = APIRouter(prefix="/filament-catalog", tags=["catalog"])


@router.get("/search")
def search_catalog(
    q: str | None = None,
    material: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Поиск по SpoolmanDB. Возвращает записи в форме для автозаполнения катушки."""
    if not q or len(q.strip()) < 2:
        return []
    return spoolmandb.search(db, q=q, material=material, limit=min(limit, 50))


@router.get("/info")
def catalog_info(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return spoolmandb.info(db)


@router.post("/refresh")
def refresh_catalog(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    try:
        count = spoolmandb.refresh(db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SpoolmanDB недоступен: {e}")
    return {"count": count, **spoolmandb.info(db)}
