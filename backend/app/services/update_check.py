"""Проверка новых версий на GitHub.

Релизы публикуются тегом vX.Y.Z (см. .github/workflows/build-images.yml), и то же
значение попадает в APP_VERSION собранного образа. Здесь просто сравниваем версию
с последним релизом репозитория и отдаём результат в UI (попап + подвал настроек).

Результат кэшируется в app_settings (а не в памяти процесса, как у Home Assistant):
бэкенд поднят несколькими воркерами плюс отдельный поллер, и общий кэш в БД не даёт
им независимо дёргать GitHub. Любая ошибка запроса — сеть недоступна, лимит запросов,
GitHub недоступен — гасится: страница не должна ломаться из-за внешнего сервиса.
"""
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import settings_service

log = logging.getLogger("update_check")

GITHUB_REPO = "dobriys/filament_tracker"
CACHE_KEY = "update_check_cache"
CACHE_TTL = timedelta(hours=6)
TIMEOUT_SEC = 5

_VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def _parse_version(v: str | None) -> tuple[int, int, int] | None:
    """"vX.Y.Z" → (X, Y, Z). None для сборок не из тега ("dev", "latest")."""
    if not v:
        return None
    m = _VERSION_RE.match(v.strip())
    if not m:
        return None
    return tuple(int(g) for g in m.groups())


def _fetch_latest_release() -> dict | None:
    """Последний релиз с GitHub. Без User-Agent GitHub API отвечает 403."""
    r = httpx.get(
        f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "filament-tracker-update-check",
        },
        timeout=TIMEOUT_SEC,
    )
    r.raise_for_status()
    payload = r.json()
    return {
        "latest_version": payload.get("tag_name"),
        "release_url": payload.get("html_url"),
    }


def get_status(db: Session) -> dict:
    current_version = settings.app_version

    cached = settings_service.get_value(db, CACHE_KEY)
    fresh = None
    if isinstance(cached, dict) and cached.get("checked_at"):
        try:
            checked_at = datetime.fromisoformat(cached["checked_at"])
        except ValueError:
            checked_at = None
        if checked_at and datetime.now(timezone.utc) - checked_at < CACHE_TTL:
            fresh = cached

    release = fresh
    if release is None:
        try:
            fetched = _fetch_latest_release()
        except Exception as e:
            log.info("проверка обновлений на GitHub не удалась: %s", e)
            fetched = None
        checked_at = datetime.now(timezone.utc).isoformat()
        if fetched is not None:
            release = {**fetched, "checked_at": checked_at}
            settings_service.set_value(db, CACHE_KEY, release)
        else:
            # GitHub недоступен — используем последнее известное значение, чтобы
            # не терять "known good" при временном сбое.
            release = cached if isinstance(cached, dict) else {"latest_version": None, "release_url": None, "checked_at": checked_at}

    current_tuple = _parse_version(current_version)
    latest_tuple = _parse_version(release.get("latest_version"))
    update_available = bool(current_tuple and latest_tuple and latest_tuple > current_tuple)

    return {
        "current_version": current_version,
        "latest_version": release.get("latest_version"),
        "update_available": update_available,
        "release_url": release.get("release_url"),
        "checked_at": release.get("checked_at"),
    }
