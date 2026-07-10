from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core import request_context
from app.core.config import settings
from app.db.session import SessionLocal
from app.services import diagnostics
from app.services.catalog_seed import seed_catalog
from app.services.secret_service import ensure_secrets


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Стартовый каталог при первом запуске. Первый администратор создаётся
    # через форму первичной настройки (/api/auth/setup) при первом входе.
    db = SessionLocal()
    try:
        ensure_secrets(db)  # авто-генерация ключей, если не заданы через env
        seed_catalog(db)
        diagnostics.load_enabled(db)  # кэшируем флаг записи ошибок из БД
    finally:
        db.close()
    yield


app = FastAPI(title="Filament Inventory Tracker", lifespan=lifespan)

# CORS. Авторизация — Bearer-заголовок (кук нет), поэтому wildcard безопасен;
# с "*" credentials обязаны быть выключены (требование спецификации CORS).
_origins = settings.cors_origins_list
_wildcard = not _origins or "*" in _origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _wildcard else _origins,
    allow_credentials=not _wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def capture_frontend_origin(request: Request, call_next):
    """Запоминает, с какого адреса открыт интерфейс (для QR-ссылок).

    Origin присылается браузером на все cross-origin запросы; Referer — запасной
    вариант (обрезается до scheme://host:port).
    """
    origin = request.headers.get("origin")
    if not origin:
        ref = request.headers.get("referer")
        if ref:
            p = urlsplit(ref)
            if p.scheme and p.netloc:
                origin = f"{p.scheme}://{p.netloc}"
    request_context.set_frontend_origin(origin)
    return await call_next(request)


# Пишет необработанные исключения в диагностический журнал (если включён).
app.middleware("http")(diagnostics.error_capture_middleware)


app.include_router(api_router)


@app.get("/health")
def health():
    return {"status": "ok", "version": settings.app_version}
