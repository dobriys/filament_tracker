from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    postgres_user: str = "filament"
    postgres_password: str = "filament"
    postgres_db: str = "filament_tracker"
    postgres_host: str = "db"
    postgres_port: int = 5432

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Интервал фонового опроса Moonraker-принтеров, сек (воркер-поллер)
    moonraker_poll_interval: int = 30

    # Версия приложения (проставляется при сборке образа)
    app_version: str = "dev"

    # Security
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 1440
    algorithm: str = "HS256"
    encryption_key: str = "change-me-generate-a-fernet-key"

    # Базовый URL фронтенда — в него ведёт QR-код катушки ({base}/s/{token}).
    # Пусто = определяется автоматически по адресу, с которого открыт интерфейс.
    frontend_base_url: str = ""

    # CORS — храним строкой (через запятую), список отдаём через property.
    # pydantic-settings пытается JSON-парсить поля-списки из env, поэтому str.
    # По умолчанию "*": авторизация по Bearer-заголовку (без кук), поэтому
    # wildcard безопасен и позволяет заходить с любого адреса без настройки.
    cors_origins: str = "*"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
