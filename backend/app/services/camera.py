"""Снимок с камеры принтера — картинка к Telegram-уведомлению.

Отдельной сущности «камера» нет: адрес кадра либо задан у принтера
(поле camera_url), либо выясняется у самого Moonraker (/server/webcams/list),
либо угадывается по типовому пути mjpg-streamer. Сработавший адрес запоминаем
в app_settings — поллер не должен перебирать кандидатов на каждом событии.

Относительный адрес из webcams-списка приходится примерять к двум базам:
у классической сборки Moonraker слушает :7125, а камеру раздаёт nginx на 80,
и «/webcam/?action=snapshot» написан именно для второго (см. candidates).

Отдаём кадр JPEG. Половина адресов камеры — это ?action=stream, бесконечный
multipart: из такого потока берём первый целый кадр и рвём соединение.

Ошибок наружу не выпускаем: нет камеры — уведомление уйдёт просто текстом.
"""
import logging
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret
from app.models import Printer
from app.services import settings_service
from app.services.moonraker import MoonrakerClient

log = logging.getLogger("camera")

# Найденный адрес снимка, по принтеру: camera_url:<printer_id>.
DETECTED_PREFIX = "camera_url:"
# Камера не должна задерживать цикл поллера: кадр либо приходит быстро, либо
# уведомление уходит без него.
TIMEOUT_SEC = 5.0
# Telegram принимает фото до 10 МБ; кадр камеры на порядок меньше, а лишнее
# качать незачем — на этом пределе поток обрывается.
MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024
# Куда смотреть, если Moonraker о камерах молчит: так mjpg-streamer публикуют
# и Mainsail, и Fluidd.
DEFAULT_PATHS = ("/webcam/?action=snapshot", "/webcam/?action=stream")

JPEG_SOI = b"\xff\xd8\xff"
JPEG_EOI = b"\xff\xd9"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# --- разбор адресов (чистые функции) -----------------------------------------

def webcam_urls(webcams: list[dict]) -> list[str]:
    """Адреса кадров из списка камер Moonraker: сначала снимок, потом поток.

    Выключенные камеры пропускаем — Moonraker отдаёт их вместе с рабочими.
    """
    out: list[str] = []
    for cam in webcams or []:
        if not isinstance(cam, dict) or cam.get("enabled") is False:
            continue
        for key in ("snapshot_url", "stream_url"):
            url = str(cam.get(key) or "").strip()
            if url and url not in out:
                out.append(url)
    return out


def absolute(base: str, url: str) -> str | None:
    """Адрес камеры → абсолютный. Относительный достраивается от базы."""
    url = (url or "").strip()
    if not url:
        return None
    if url.startswith(("http://", "https://")):
        return url
    base = (base or "").strip().rstrip("/")
    if not base:
        return None
    return f"{base}/{url.lstrip('/')}"


# Порт «по умолчанию» — отбрасывать его незачем, адрес получится тот же.
DEFAULT_PORTS = {"http": 80, "https": 443}


def host_root(base: str) -> str | None:
    """Тот же хост без порта — вторая база для относительных адресов."""
    parts = urlsplit(base or "")
    if not parts.scheme or not parts.hostname or not parts.port:
        return None
    if parts.port == DEFAULT_PORTS.get(parts.scheme):
        return None
    return urlunsplit((parts.scheme, parts.hostname, "", "", ""))


def candidates(base: str, urls: list[str]) -> list[str]:
    """Кандидаты в адрес кадра: каждый относительный — от обеих баз."""
    roots = [r for r in (base, host_root(base)) if r]
    out: list[str] = []
    for url in urls:
        for root in roots or [""]:
            full = absolute(root, url)
            if full and full not in out:
                out.append(full)
    return out


# --- разбор ответа камеры (чистые функции) -----------------------------------

def looks_like_image(data: bytes) -> bool:
    return bool(data) and (data.startswith(JPEG_SOI) or data.startswith(PNG_MAGIC))


def first_jpeg_frame(data: bytes) -> bytes | None:
    """Первый целый кадр JPEG — из multipart-потока mjpg-streamer."""
    start = data.find(JPEG_SOI)
    if start < 0:
        return None
    end = data.find(JPEG_EOI, start + len(JPEG_SOI))
    if end < 0:
        return None
    return data[start:end + len(JPEG_EOI)]


# --- сеть --------------------------------------------------------------------

def fetch(
    url: str,
    *,
    api_key: str | None = None,
    timeout: float = TIMEOUT_SEC,
    transport: httpx.BaseTransport | None = None,
) -> bytes | None:
    """Кадр по адресу камеры (None — ответ не похож на картинку).

    Ошибки сети пробрасываются: снаружи решают, пробовать ли следующий адрес.
    """
    headers = {"X-Api-Key": api_key} if api_key else {}
    with httpx.Client(
        timeout=timeout, headers=headers, transport=transport, follow_redirects=True
    ) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            multipart = "multipart" in (resp.headers.get("content-type") or "").lower()
            buf = bytearray()
            for chunk in resp.iter_bytes():
                buf.extend(chunk)
                # Поток бесконечен — уходим с первым же целым кадром.
                if multipart:
                    frame = first_jpeg_frame(bytes(buf))
                    if frame:
                        return frame
                if len(buf) >= MAX_SNAPSHOT_BYTES:
                    break
            data = bytes(buf)
            return data if looks_like_image(data) else first_jpeg_frame(data)


def _api_key(printer: Printer) -> str | None:
    if not printer.moonraker_api_key_encrypted:
        return None
    try:
        return decrypt_secret(printer.moonraker_api_key_encrypted)
    except Exception:
        return None


def discover(printer: Printer, *, transport: httpx.BaseTransport | None = None) -> list[str]:
    """Кандидаты в адрес кадра для принтера без заданного camera_url."""
    base = (printer.moonraker_url or "").rstrip("/")
    if printer.integration_type != "moonraker" or not base:
        return []
    try:
        client = MoonrakerClient(
            base, _api_key(printer), timeout=TIMEOUT_SEC, transport=transport
        )
        known = webcam_urls(client.get_webcams())
    except Exception:
        known = []
    return candidates(base, known + list(DEFAULT_PATHS))


def snapshot_with_url(
    db: Session, printer: Printer, *, transport: httpx.BaseTransport | None = None
) -> tuple[str | None, bytes | None]:
    """Кадр с камеры и адрес, по которому он нашёлся. Наружу не бросает ничего.

    Запомненный адрес пробуется первым; если он больше не отвечает (камеру
    переставили, сменился порт) — ищем заново и запоминаем новый.
    """
    key = f"{DETECTED_PREFIX}{printer.id}"
    tried: list[str] = []

    def attempt(url: str) -> bytes | None:
        if url in tried:
            return None
        tried.append(url)
        try:
            return fetch(url, api_key=_api_key(printer), transport=transport)
        except Exception as e:
            log.debug("камера %s (%s): %s", printer.name, url, e)
            return None

    explicit = absolute(printer.moonraker_url or "", printer.camera_url or "")
    if explicit:
        return explicit, attempt(explicit)

    remembered = settings_service.get_value(db, key)
    if isinstance(remembered, str):
        data = attempt(remembered)
        if data:
            return remembered, data

    for url in discover(printer, transport=transport):
        data = attempt(url)
        if data:
            if url != remembered:
                settings_service.set_value(db, key, url)
            return url, data

    if isinstance(remembered, str):
        # Забываем протухший адрес: в следующий раз ищем с чистого листа.
        settings_service.set_value(db, key, None)
    return None, None


def snapshot(
    db: Session, printer: Printer, *, transport: httpx.BaseTransport | None = None
) -> bytes | None:
    """Кадр с камеры принтера или None."""
    return snapshot_with_url(db, printer, transport=transport)[1]
