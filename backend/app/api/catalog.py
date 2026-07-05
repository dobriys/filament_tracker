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
    brand: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Поиск/просмотр SpoolmanDB. Записи в форме для автозаполнения катушки.

    Нужен хотя бы один критерий: запрос (≥2 символов), бренд или материал. При
    просмотре по бренду сортируем A→Я и разрешаем больший лимит.
    """
    has_q = bool(q and len(q.strip()) >= 2)
    if not (has_q or brand or material):
        return []
    browse = bool(brand or material) and not has_q
    return spoolmandb.search(
        db, q=q, material=material, brand=brand,
        limit=min(limit, 500 if browse else 50), sort=browse,
    )


@router.get("/brands")
def catalog_brands(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Список брендов каталога (A→Я) с числом моделей."""
    return spoolmandb.brands(db)


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
