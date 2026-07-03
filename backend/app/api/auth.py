from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas.auth import SetupRequest, Token
from app.schemas.user import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


# --- Первый запуск: регистрация администратора вместо преднастроенных кредов ---
@router.get("/setup-status")
def setup_status(db: Session = Depends(get_db)):
    """Нужна ли первичная настройка (в системе ещё нет ни одного пользователя)."""
    return {"needs_setup": db.scalar(select(User).limit(1)) is None}


@router.post("/setup", response_model=Token, status_code=status.HTTP_201_CREATED)
def setup(data: SetupRequest, db: Session = Depends(get_db)):
    """Создаёт первого администратора. Работает только пока пользователей нет."""
    if db.scalar(select(User).limit(1)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Настройка уже выполнена — войдите под своей учётной записью",
        )
    if len(data.password) < 6:
        raise HTTPException(
            status_code=422, detail="Пароль должен быть не короче 6 символов"
        )
    admin = User(
        email=data.email,
        username="admin",
        password_hash=hash_password(data.password),
        role="admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return Token(access_token=create_access_token(str(admin.id)))


@router.post("/login", response_model=Token)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # OAuth2PasswordRequestForm использует поле "username" — сюда кладём email.
    user = db.scalar(select(User).where(User.email == form.username))
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Пользователь заблокирован"
        )
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/logout")
def logout():
    # JWT stateless: фактический logout — удаление токена на клиенте.
    return {"detail": "ok"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
