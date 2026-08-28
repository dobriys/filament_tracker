"""Наблюдение за живым состоянием принтера для уведомлений.

Поллер до этого читал только историю заданий, поэтому «печать началась»,
«ошибка», «сушка включена» нигде не фиксировались — их видел лишь браузер, пока
открыта вкладка. Здесь каждый цикл опроса снимается срез состояния
(print_stats + сушка + доступность), сравнивается с предыдущим и превращается в
события уведомлений.

Предыдущий срез хранится в app_settings (ключ printer_watch:<printer_id>) —
как и водяной знак moonraker_sync: поллер живёт отдельным процессом и память
между циклами не переживает.

При первом наблюдении за принтером события не выдаются: срез просто
запоминается, иначе после каждого рестарта поллера сыпались бы уведомления о
состоянии, которое на самом деле не менялось.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Printer, PrintJob
from app.services import notifications, print_job_service, settings_service
from app.services.moonraker import MoonrakerClient
from app.services.moonraker_sync import client_for

log = logging.getLogger("printer_watch")

STATE_PREFIX = "printer_watch:"

# Символы частых валют — на бэкенде готового форматтера денег нет.
_CURRENCY_SYMBOL = {
    "RUB": "₽", "USD": "$", "EUR": "€", "UAH": "₴", "KZT": "₸", "BYN": "Br", "GBP": "£",
}


def _fmt_money(amount: float, currency: str) -> str:
    return f"{amount:.0f} {_CURRENCY_SYMBOL.get(currency, currency)}"


def _finished_extra(db: Session, printer: Printer, filename: str | None) -> str:
    """Доп. строки к «Печать завершена»: время окончания и себестоимость.

    Задание к этому моменту уже импортировано (moonraker_sync в поллере идёт
    раньше). Ищем его по имени файла среди свежих заданий принтера; стоимость
    показываем только когда она известна — то есть печать уже списана и у
    катушек задана цена (иначе jobs_cost вернёт пусто).
    """
    fn = (filename or "").split("/")[-1].strip().lower()
    jobs = list(
        db.scalars(
            select(PrintJob)
            .where(PrintJob.printer_id == printer.id)
            .order_by(PrintJob.created_at.desc())
            .limit(10)
        )
    )
    job = next(
        (j for j in jobs if fn and (j.file_name or "").split("/")[-1].strip().lower() == fn),
        None,
    )
    if job is None:
        job = jobs[0] if jobs else None

    ts = job.completed_at if (job and job.completed_at) else datetime.now(timezone.utc)
    # Часовой пояс из настроек (в базе всё в UTC, а контейнер обычно живёт по UTC).
    lines = [f"Завершена: {settings_service.to_local(db, ts):%d.%m.%Y %H:%M}"]

    if job is not None:
        info = print_job_service.jobs_cost(db, [job.id]).get(job.id)
        if info and info.get("currency"):
            lines.append(f"Себестоимость: {_fmt_money(info['cost'], info['currency'])}")

    return "\n" + "\n".join(lines)

# Состояния Klipper (print_stats.state) → тип события уведомления.
STATE_EVENTS = {
    "printing": "print_started",
    "complete": "print_finished",
    "error": "print_error",
    "paused": "print_paused",
    "cancelled": "print_cancelled",
}

# Значения dryer_status, означающие «сушка не идёт».
DRYER_IDLE = {"stop", "stopped", "idle", "off", "", None}


def _dryer_running(dryer: dict | None) -> bool:
    if not isinstance(dryer, dict):
        return False
    status = dryer.get("status")
    if isinstance(status, str):
        status = status.strip().lower()
    return status not in DRYER_IDLE


def snapshot(status: dict | None, dryer: dict | None, *, online: bool) -> dict:
    """Срез состояния принтера — только то, по чему считаются переходы."""
    status = status or {}
    return {
        "online": online,
        "state": status.get("state"),
        "filename": status.get("filename"),
        "message": status.get("message"),
        "dryer": _dryer_running(dryer),
    }


def diff(prev: dict, cur: dict, printer_name: str) -> list[tuple[str, str]]:
    """Переходы между срезами → [(тип события, текст сообщения)].

    Чистая функция: вся логика «что считать изменением» тестируется без сети.
    """
    out: list[tuple[str, str]] = []
    name = notifications.esc(printer_name)

    # Доступность. Пока принтер офлайн, остальные поля недостоверны —
    # сравнивать их бессмысленно, поэтому выходим сразу.
    if prev.get("online") and not cur.get("online"):
        out.append(("printer_offline", f"🔌 <b>{name}</b>\nПринтер недоступен"))
        return out
    if not prev.get("online") and cur.get("online"):
        out.append(("printer_offline", f"✅ <b>{name}</b>\nПринтер снова на связи"))
    if not cur.get("online"):
        return out

    # Состояние печати: событие только на смене состояния.
    if prev.get("state") != cur.get("state"):
        event = STATE_EVENTS.get(cur.get("state"))
        if event:
            file_name = notifications.esc(cur.get("filename") or "")
            suffix = f"\n{file_name}" if file_name else ""
            if event == "print_started":
                out.append((event, f"🖨 <b>{name}</b>\nПечать началась{suffix}"))
            elif event == "print_finished":
                out.append((event, f"🎉 <b>{name}</b>\nПечать завершена{suffix}"))
            elif event == "print_error":
                message = notifications.esc(cur.get("message") or "")
                detail = f"\n{message}" if message else ""
                out.append((event, f"🛑 <b>{name}</b>\nОшибка печати{suffix}{detail}"))
            elif event == "print_paused":
                out.append((event, f"⏸ <b>{name}</b>\nПечать на паузе{suffix}"))
            elif event == "print_cancelled":
                out.append((event, f"⏹ <b>{name}</b>\nПечать отменена{suffix}"))

    # Сушка.
    if prev.get("dryer") != cur.get("dryer"):
        if cur.get("dryer"):
            out.append(("dryer_started", f"🌡 <b>{name}</b>\nСушка включена"))
        else:
            out.append(("dryer_finished", f"🍃 <b>{name}</b>\nСушка завершена"))

    return out


def watch_printer(db: Session, printer: Printer) -> list[str]:
    """Один цикл наблюдения за принтером. Возвращает отправленные события."""
    key = f"{STATE_PREFIX}{printer.id}"
    prev = settings_service.get_value(db, key)

    client: MoonrakerClient = client_for(printer)
    try:
        cur = snapshot(client.get_status(), client.get_hub_data().get("dryer"), online=True)
    except Exception as e:
        log.debug("watch %s: %s", printer.name, e)
        cur = snapshot(None, None, online=False)
        # Офлайн-срез не должен затирать последнее известное состояние печати:
        # иначе при возврате принтера в сеть переход state вычислится неверно.
        if isinstance(prev, dict):
            cur.update({k: prev.get(k) for k in ("state", "filename", "message", "dryer")})

    if not isinstance(prev, dict):
        # Первое наблюдение — только запоминаем.
        settings_service.set_value(db, key, cur)
        return []

    sent = []
    for event, text in diff(prev, cur, printer.name):
        # «Печать завершена» дополняем временем окончания и себестоимостью —
        # для этого нужен доступ к БД, поэтому это здесь, а не в чистой diff.
        if event == "print_finished":
            try:
                text += _finished_extra(db, printer, cur.get("filename"))
            except Exception as e:  # обогащение не должно мешать самому уведомлению
                log.warning("finished extra %s failed: %s", printer.name, e)
        # printer — чтобы к событию печати приложился кадр с его камеры.
        if notifications.notify(db, event, text, printer=printer):
            sent.append(event)
    settings_service.set_value(db, key, cur)
    return sent


def watch_all(db: Session) -> None:
    """Наблюдение за всеми активными Moonraker-принтерами.

    Пропускается целиком, пока уведомления не настроены — чтобы не создавать
    лишнюю нагрузку на принтеры у тех, кому уведомления не нужны.
    """
    if not settings_service.get_bool(db, notifications.ENABLED_KEY, default=False):
        return
    if not notifications.is_configured(db):
        return
    printers = db.scalars(
        select(Printer).where(
            Printer.integration_type == "moonraker",
            Printer.is_active.is_(True),
            Printer.moonraker_url.isnot(None),
        )
    )
    for printer in printers:
        try:
            watch_printer(db, printer)
        except Exception as e:  # не валим цикл поллера из-за одного принтера
            log.warning("watch %s failed: %s", printer.name, e)
