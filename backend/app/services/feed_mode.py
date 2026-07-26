"""Режим подачи филамента: мультиподача (MMU/ACE) или прямая одна катушка.

Мультиподачу снимают: хаб отключают от принтера, а филамент подают напрямую с
держателя. Принтер при этом тот же самый — заводить второй ради этого нельзя
(один Moonraker URL на два принтера = двойной импорт заданий и разъехавшаяся
статистика), поэтому режим подачи живёт в capabilities самого принтера.

Настройка `capabilities.feed_mode` (что выбрал пользователь):
  auto   — определять по телеметрии (умолчание);
  mmu    — держать мультиподачу, что бы ни отвечал хаб;
  direct — прямая подача, живая телеметрия хаба игнорируется.

В ответе API тот же ключ отдаёт уже РАЗРЕШЁННЫЙ режим ("mmu"/"direct"), а выбор
пользователя едет рядом в `feed_mode_setting`: фронту нужны оба — первый рисует
карточку, второй заполняет селект.

Автоопределение опирается на два сигнала. Первый — флаг mmu.enabled: снятый ACE
остаётся в телеметрии Rinkhals (гейты и нули сушилки никуда не деваются), но
приходит с enabled=false, и это прямой ответ железа, по которому переключаемся
сразу. Второй — молчание хаба, и вот тут нужен гистерезис: get_hub_data() глушит
ошибки и на любой сетевой сбой отдаёт пустые гейты, поэтому одного пустого
ответа мало — режим меняется после MISSES_TO_DIRECT опросов подряд.

Решение вынесено в чистые функции (next_misses / effective_capabilities), в БД
ходит только resolve_capabilities.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, Printer, PrinterSlot
from app.services import settings_service
from app.services.moonraker import detect_capabilities

MODES = ("auto", "mmu", "direct")

# Сколько опросов подряд без хаба считаем достаточным поводом объявить прямую
# подачу. При обычном темпе опроса панели (~7 с) это меньше минуты — хватает,
# чтобы пережить перезагрузку ACE и не мигать режимом.
MISSES_TO_DIRECT = 3

_PROBE_PREFIX = "feed_probe:"


def setting_of(capabilities: dict | None) -> str:
    """Выбор пользователя из capabilities; неизвестное значение → auto."""
    mode = (capabilities or {}).get("feed_mode")
    return mode if mode in MODES else "auto"


def next_misses(misses: int, *, has_gates: bool, online: bool) -> int:
    """Счётчик пустых ответов хаба подряд после очередного опроса.

    Офлайн ничего не значит: пустые гейты там — следствие обрыва связи,
    а не отключённой мультиподачи, поэтому счётчик замирает.
    """
    if not online:
        return misses
    return 0 if has_gates else min(misses + 1, MISSES_TO_DIRECT)


def effective_capabilities(
    stored: dict | None, *, gates: list | None, dryer: dict | None,
    setting: str, hub_missing: bool,
) -> dict:
    """Возможности принтера: пресет + живая телеметрия + выбор пользователя.

    hub_missing — отсутствие хаба подтверждено серией опросов (см. next_misses);
    учитывается только в режиме auto.
    """
    caps = {**(stored or {}), **detect_capabilities(gates, dryer)}

    if setting == "direct" or (setting == "auto" and hub_missing):
        # mmu_off отличает «мультиподача есть, но снята» от «её тут и не было»:
        # первому UI пишет, что именно отключено, второму — ничего.
        if (stored or {}).get("has_mmu"):
            caps["mmu_off"] = True
        caps["has_mmu"] = False
        caps["has_dryer"] = False
        # Число слотов мультиподачи в прямой подаче бессмысленно, а карточку
        # оно рисует (PrinterArt) — убираем, mmu_name оставляем для подписей.
        caps.pop("mmu_slots", None)

    caps["feed_mode"] = "mmu" if caps.get("has_mmu") else "direct"
    caps["feed_mode_setting"] = setting
    return caps


def resolve_capabilities(
    db: Session, printer: Printer, *, gates: list | None, dryer: dict | None,
    online: bool, mmu_enabled: bool | None = None,
) -> dict:
    """effective_capabilities + ведение счётчика автоопределения в настройках.

    mmu_enabled — флаг mmu.enabled из телеметрии (parse_hub_enabled). False —
    хаб ответил и сам сказал, что выключен: это не сбой связи, а факт, поэтому
    переключаемся сразу, без накопления пропусков. None — флага нет (принтер без
    мультиподачи или обрыв связи), тогда решает счётчик пустых ответов.
    """
    hub_off = mmu_enabled is False
    key = f"{_PROBE_PREFIX}{printer.id}"
    misses = int(settings_service.get_value(db, key, 0) or 0)
    updated = next_misses(misses, has_gates=bool(gates) and not hub_off, online=online)
    if updated != misses:
        settings_service.set_value(db, key, updated)
    return effective_capabilities(
        printer.capabilities,
        gates=gates,
        dryer=dryer,
        setting=setting_of(printer.capabilities),
        hub_missing=hub_off or updated >= MISSES_TO_DIRECT,
    )


def set_mode(db: Session, printer: Printer, mode: str) -> Printer:
    """Сохранить выбор режима и привести слоты в соответствие.

    Слоты не удаляем никогда — на них висит история назначений и расход печатей.
    Прямая подача оставляет активным только слот 1: именно в него ложится катушка
    с держателя, и именно к нему автосписание привязывает tool 0 (см.
    moonraker_sync.resolve_slot_mappings). Возврат к мультиподаче включает все.
    Режим auto слоты не трогает — там решение принимает телеметрия, и молча
    гасить слоты на сетевом сбое было бы хуже, чем оставить лишние.
    """
    if mode not in MODES:
        raise ValueError(f"Неизвестный режим подачи: {mode}")
    printer.capabilities = {**(printer.capabilities or {}), "feed_mode": mode}

    if mode in ("direct", "mmu"):
        slots = db.scalars(select(PrinterSlot).where(PrinterSlot.printer_id == printer.id))
        for slot in slots:
            slot.is_active = True if mode == "mmu" else slot.slot_index <= 1

    # Автоопределение начинает наблюдение заново: прежний счётчик относится к
    # прошлому состоянию железа.
    row = db.get(AppSetting, f"{_PROBE_PREFIX}{printer.id}")
    if row is not None:
        db.delete(row)
    db.commit()
    db.refresh(printer)
    return printer
