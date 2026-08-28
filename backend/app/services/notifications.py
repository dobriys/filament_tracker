"""Уведомления в Telegram об изменениях состояния принтера и склада.

Что и когда отправляется, решает пользователь: в Настройках есть общий
выключатель, поля бота (токен хранится зашифрованным, как ключи принтеров) и
отдельный чекбокс на каждый тип события — см. EVENTS.

Источник событий — фоновый поллер (app/workers/poller.py):
  - printer_watch сравнивает живое состояние принтера с прошлым циклом и
    выдаёт события печати/сушки/доступности;
  - moonraker_sync шлёт «автосписание не удалось»;
  - print_job_service — «катушка заканчивается» после списания;
  - environment_watch — «влажность выше порога» по датчикам Home Assistant.

К событиям печати можно прикладывать кадр с камеры принтера (см.
services/camera.py): свой выключатель PHOTO_ENABLED_KEY и свой набор событий
PHOTO_EVENTS — «что отправлять» и «к чему прикладывать снимок» это разные
вопросы. Камера не отвечает — уходит обычное текстовое сообщение.

Отправка никогда не должна ронять вызывающий код: любая ошибка сети или
конфига гасится и уходит в диагностический журнал.
"""
import html
import logging

import httpx
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret, encrypt_secret
from app.services import camera, diagnostics, settings_service

log = logging.getLogger("notifications")

ENABLED_KEY = "telegram_enabled"
TOKEN_KEY = "telegram_bot_token_encrypted"
CHAT_ID_KEY = "telegram_chat_id"
EVENTS_KEY = "telegram_events"
PHOTO_ENABLED_KEY = "telegram_photo_enabled"
PHOTO_EVENTS_KEY = "telegram_photo_events"

# Типы событий и значения по умолчанию. Шумные (старт печати, пауза, отмена)
# выключены по умолчанию — включаются осознанно.
EVENTS: dict[str, bool] = {
    "print_started": False,
    "print_finished": True,
    "print_error": True,
    "print_paused": True,
    "print_cancelled": False,
    "printer_offline": False,
    "dryer_started": False,
    "dryer_finished": True,
    "consume_failed": True,
    "feed_changed": True,
    "spool_low": True,
    "humidity_high": True,
}

# К каким событиям прикладывается кадр с камеры. Только печать: сушка, склад и
# датчики к камере отношения не имеют. Пока PHOTO_ENABLED_KEY выключен, флаги
# ни на что не влияют.
PHOTO_EVENTS: dict[str, bool] = {
    "print_started": True,
    "print_finished": True,
    "print_error": True,
    "print_cancelled": True,
    "print_paused": True,
}

# Предел подписи к фото у Telegram. Текст уведомления в него укладывается, но
# ошибка от прошивки бывает длинной — тогда шлём кадр и текст порознь.
CAPTION_LIMIT = 1024

TELEGRAM_API = "https://api.telegram.org"
TIMEOUT_SEC = 10


# --- конфигурация ------------------------------------------------------------

def get_token(db: Session) -> str | None:
    """Расшифрованный токен бота (None, если не задан или ключ сменился)."""
    enc = settings_service.get_value(db, TOKEN_KEY)
    if not enc:
        return None
    try:
        return decrypt_secret(enc)
    except Exception:
        log.warning("не удалось расшифровать токен Telegram")
        return None


def set_token(db: Session, token: str | None) -> None:
    settings_service.set_value(db, TOKEN_KEY, encrypt_secret(token) if token else None)


def get_events(db: Session) -> dict[str, bool]:
    """Флаги событий с подстановкой значений по умолчанию для новых типов."""
    saved = settings_service.get_value(db, EVENTS_KEY) or {}
    if not isinstance(saved, dict):
        saved = {}
    return {key: bool(saved.get(key, default)) for key, default in EVENTS.items()}


def set_events(db: Session, events: dict[str, bool]) -> None:
    current = get_events(db)
    for key, value in events.items():
        if key in EVENTS:
            current[key] = bool(value)
    settings_service.set_value(db, EVENTS_KEY, current)


def get_photo_events(db: Session) -> dict[str, bool]:
    """Флаги «прикладывать снимок» с подстановкой значений по умолчанию."""
    saved = settings_service.get_value(db, PHOTO_EVENTS_KEY) or {}
    if not isinstance(saved, dict):
        saved = {}
    return {key: bool(saved.get(key, default)) for key, default in PHOTO_EVENTS.items()}


def set_photo_events(db: Session, events: dict[str, bool]) -> None:
    current = get_photo_events(db)
    for key, value in events.items():
        if key in PHOTO_EVENTS:
            current[key] = bool(value)
    settings_service.set_value(db, PHOTO_EVENTS_KEY, current)


def wants_photo(db: Session, event: str) -> bool:
    """Нужен ли кадр с камеры к этому событию."""
    if event not in PHOTO_EVENTS:
        return False
    if not settings_service.get_bool(db, PHOTO_ENABLED_KEY, default=False):
        return False
    return get_photo_events(db).get(event, False)


def is_configured(db: Session) -> bool:
    return bool(get_token(db) and settings_service.get_value(db, CHAT_ID_KEY))


# --- отправка ----------------------------------------------------------------

def send_message(token: str, chat_id: str, text: str) -> dict:
    """Низкоуровневая отправка. Бросает исключение — используется в «Тесте»."""
    r = httpx.post(
        f"{TELEGRAM_API}/bot{token}/sendMessage",
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=TIMEOUT_SEC,
    )
    payload = {}
    try:
        payload = r.json()
    except Exception:
        pass
    if not payload.get("ok"):
        detail = payload.get("description") or f"HTTP {r.status_code}"
        raise RuntimeError(detail)
    return payload


def send_photo(token: str, chat_id: str, photo: bytes, caption: str = "") -> dict:
    """Кадр с камеры с подписью-уведомлением. Бросает исключение, как и текст.

    Картинка и текст уходят одним сообщением: в Telegram подпись показывается
    под фото, поэтому отдельное сообщение вслед за кадром было бы лишним.
    """
    r = httpx.post(
        f"{TELEGRAM_API}/bot{token}/sendPhoto",
        data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
        files={"photo": ("snapshot.jpg", photo, "image/jpeg")},
        timeout=TIMEOUT_SEC,
    )
    payload = {}
    try:
        payload = r.json()
    except Exception:
        pass
    if not payload.get("ok"):
        detail = payload.get("description") or f"HTTP {r.status_code}"
        raise RuntimeError(detail)
    return payload


def _snapshot(db: Session, event: str, printer) -> bytes | None:
    """Кадр к событию — или None, если камера не нужна и не отвечает."""
    if printer is None or not wants_photo(db, event):
        return None
    try:
        return camera.snapshot(db, printer)
    except Exception as e:  # камера не должна мешать самому уведомлению
        log.warning("камера %s: %s", getattr(printer, "name", "?"), e)
        return None


def notify(db: Session, event: str, text: str, printer=None) -> bool:
    """Отправить уведомление, если оно включено. Ошибки не пробрасываются.

    printer — принтер, с камеры которого брать кадр (события печати). Без него
    и при недоступной камере уходит обычное текстовое сообщение.

    Возвращает True, только если сообщение действительно ушло.
    """
    if event not in EVENTS:
        log.warning("неизвестный тип события: %s", event)
        return False
    if not settings_service.get_bool(db, ENABLED_KEY, default=False):
        return False
    if not get_events(db).get(event):
        return False

    token = get_token(db)
    chat_id = settings_service.get_value(db, CHAT_ID_KEY)
    if not token or not chat_id:
        return False

    photo = _snapshot(db, event, printer)
    if photo:
        try:
            if len(text) <= CAPTION_LIMIT:
                send_photo(token, str(chat_id), photo, text)
                return True
            # Длинный текст в подпись не влезет: сначала кадр, следом сообщение.
            send_photo(token, str(chat_id), photo)
        except Exception as e:
            # Кадр не ушёл — уведомление всё равно должно дойти текстом.
            log.warning("telegram photo %s: %s", event, e)

    try:
        send_message(token, str(chat_id), text)
        return True
    except Exception as e:
        log.warning("telegram %s: %s", event, e)
        diagnostics.event(
            "warning", "notifications", f"Не удалось отправить в Telegram: {e}",
            category="notify", context={"event": event},
        )
        return False


def detect_chat_id(token: str) -> list[dict]:
    """Кто недавно писал боту → кандидаты в chat id (getUpdates).

    Нужен, потому что вручную chat id добывается через сторонних ботов, а там
    легко получить чужой идентификатор: если переслать боту-определителю
    сообщение, он вернёт id его автора, а не ваш.

    Telegram отдаёт апдейты примерно за сутки и только пока не подключён
    webhook — если список пуст, пользователю надо просто написать боту.
    """
    r = httpx.get(f"{TELEGRAM_API}/bot{token}/getUpdates", timeout=TIMEOUT_SEC)
    payload = r.json()
    if not payload.get("ok"):
        raise RuntimeError(payload.get("description") or f"HTTP {r.status_code}")

    seen: dict[str, dict] = {}
    for upd in payload.get("result", []):
        msg = upd.get("message") or upd.get("channel_post") or {}
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        # Сам бот в кандидаты не годится — именно этим и промахиваются вручную.
        if chat_id is None or chat.get("is_bot"):
            continue
        title = (
            chat.get("title")
            or " ".join(filter(None, [chat.get("first_name"), chat.get("last_name")]))
            or chat.get("username")
            or str(chat_id)
        )
        seen[str(chat_id)] = {"chat_id": str(chat_id), "title": title, "type": chat.get("type")}
    return list(seen.values())


def explain_error(detail: str) -> str:
    """Подсказка к типовым ответам Telegram — сырой текст мало что объясняет.

    Самая частая ошибка при настройке: в chat id вставляют число из первой
    половины токена — это идентификатор самого бота, а не пользователя.
    """
    low = detail.lower()
    if "unauthorized" in low:
        return f"{detail}. Проверьте токен бота — его выдаёт @BotFather."
    if "can't send messages to the bot" in low or "can't talk to bots" in low:
        return (
            f"{detail}. В chat id указан идентификатор бота (число до двоеточия "
            "в токене). Нужен ваш собственный id — его подскажет @userinfobot."
        )
    if "chat not found" in low:
        return (
            f"{detail}. Проверьте chat id и напишите боту «/start»: "
            "Telegram не разрешает боту писать первым."
        )
    if "bot can't initiate conversation" in low:
        return f"{detail}. Напишите боту «/start» и повторите."
    if "blocked" in low:
        return f"{detail}. Разблокируйте бота в Telegram и повторите."
    return detail


def esc(value) -> str:
    """Экранирование для parse_mode=HTML (имена файлов, тексты ошибок)."""
    return html.escape(str(value if value is not None else ""), quote=False)
