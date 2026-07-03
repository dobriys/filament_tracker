from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SetupRequest(BaseModel):
    """Первичная регистрация администратора (пока в системе нет пользователей)."""

    email: EmailStr
    password: str
