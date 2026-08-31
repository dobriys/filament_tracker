from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.deps import get_current_user
from app.models import User
from app.services import update_check

router = APIRouter(prefix="/updates", tags=["updates"])


@router.get("/latest")
def latest(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return update_check.get_status(db)
