import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import User
from app.services import backup_service

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("/export")
def export_backup(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Полный JSON-бэкап данных пользователя (для скачивания)."""
    data = backup_service.full_backup(db, user)
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": 'attachment; filename="filament-backup.json"'},
    )


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Восстановление инвентаря из бэкапа (заменяет данные: прежние удаляются)."""
    try:
        payload = json.loads(await file.read())
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Некорректный JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Неверный формат бэкапа")
    return backup_service.restore_backup(db, user, payload)
