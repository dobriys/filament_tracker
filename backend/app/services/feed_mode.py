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

Автоопределение опирается на три сигнала, от прямого к косвенному:
  1. filament_hub.ext_spool — «печатаем с внешней катушки, ACE не подключена».
     Это утверждение о железе, работает в обе стороны и срабатывает сразу;
  2. mmu.enabled — запасной вариант для прошивок без filament_hub: false значит
     «хаб снят» (снятый ACE не пропадает из телеметрии Rinkhals — гейты и нули
     сушилки продолжают приходить, но с этим флагом);
  3. молчание хаба — тут нужен гистерезис: get_hub_data() глушит ошибки и на
     любой сетевой сбой отдаёт пустые гейты, поэтому одного пустого ответа мало,
     режим меняется после MISSES_TO_DIRECT опросов подряд.

Смена разрешённого режима запоминается (observe) и требует подтверждения от
пользователя: приложение перестаёт знать, какие катушки заряжены, поэтому до
подтверждения автосписание по этому принтеру приостанавливается (см. pending и
moonraker_sync.poll_printer).

Решение вынесено в чистые функции (next_misses / direct_by_telemetry /
effective_capabilities), в БД ходят resolve_capabilities и observe.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, Printer, PrinterSlot
from app.services import settings_service, slot_service
from app.services.moonraker import detect_capabilities

MODES = ("auto", "mmu", "direct")

# Сколько опросов подряд без хаба считаем достаточным поводом объявить прямую
# подачу. При обычном темпе опроса панели (~7 с) это меньше минуты — хватает,
# чтобы пережить перезагрузку ACE и не мигать режимом.
MISSES_TO_DIRECT = 3

_PROBE_PREFIX = "feed_probe:"
_STATE_PREFIX = "feed_state:"


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


def direct_by_telemetry(ext_spool: dict | None, mmu_enabled: bool | None) -> bool | None:
    """Прямая подача по прямому ответу железа — или None, если он ничего не сказал.

    Приоритет у ext_spool (filament_hub): «внешняя катушка задействована, ACE не
    подключена» — это утверждение о физике, а не о том, включена ли эмуляция MMU.
    Оно же работает в обе стороны: подключённый хаб сразу возвращает мультиподачу,
    не дожидаясь, пока гейты наполнятся данными.

    mmu.enabled — запасной сигнал для прошивок без filament_hub: False означает
    «хаб снят», True сам по себе ничего не гарантирует (эмуляция включена и на
    отсоединённом ACE), поэтому в мультиподачу по нему не возвращаемся.
    """
    if isinstance(ext_spool, dict):
        if ext_spool.get("hub_attached"):
            return False
        if ext_spool.get("active"):
            return True
    if mmu_enabled is False:
        return True
    return None


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
    online: bool, mmu_enabled: bool | None = None, ext_spool: dict | None = None,
) -> dict:
    """effective_capabilities + ведение счётчика автоопределения и журнала смен.

    ext_spool / mmu_enabled — прямые ответы железа (см. direct_by_telemetry).
    Когда они молчат, решает счётчик пустых ответов хаба.

    Побочный эффект: разрешённый режим запоминается, и его смена поднимает флаг
    «нужно подтвердить катушки» (см. observe / pending).
    """
    direct_now = direct_by_telemetry(ext_spool, mmu_enabled)
    if direct_now is None:
        has_gates = bool(gates)
    else:
        has_gates = not direct_now

    key = f"{_PROBE_PREFIX}{printer.id}"
    misses = int(settings_service.get_value(db, key, 0) or 0)
    updated = next_misses(misses, has_gates=has_gates, online=online)
    if updated != misses:
        settings_service.set_value(db, key, updated)

    caps = effective_capabilities(
        printer.capabilities,
        gates=gates,
        dryer=dryer,
        setting=setting_of(printer.capabilities),
        hub_missing=(
            direct_now if direct_now is not None else updated >= MISSES_TO_DIRECT
        ),
    )
    if online:
        observe(db, printer, caps["feed_mode"])
        if caps["feed_mode"] == "direct" and has_hub(printer):
            # Печатают с держателя — значит, у него должно быть своё место в
            # базе. Идемпотентно: второй раз просто вернёт готовый слот.
            slot_service.ensure_holder(db, printer)
    return caps


def has_hub(printer: Printer) -> bool:
    """Есть ли у принтера мультиподача в принципе (по пресету, а не по эфиру).

    Именно у таких принтеров «слот 1» двусмыслен: он же гейт хаба. У обычного
    принтера слот 1 и есть держатель.
    """
    caps = printer.capabilities or {}
    return bool(caps.get("has_mmu") or caps.get("mmu_slots") or caps.get("mmu_off"))


# --- смена режима и подтверждение катушек ------------------------------------

def observe(db: Session, printer: Printer, mode: str) -> dict:
    """Запомнить разрешённый режим подачи и поймать его смену.

    Смена режима означает, что железо переставили: ACE сняли (печать пошла с
    держателя) или, наоборот, поставили. В обоих случаях приложение больше не
    знает, какие катушки реально заряжены, — и пока пользователь не подтвердит,
    автосписание списывать не должно (оно жёстко мапит tool 0 → слот 1, см.
    moonraker_sync.resolve_slot_mappings, и легко спишет с чужой катушки).

    Первое наблюдение только запоминается: считать «сменой» появление принтера
    в базе нельзя, иначе подтверждать пришлось бы сразу после заведения.
    """
    key = f"{_STATE_PREFIX}{printer.id}"
    prev = settings_service.get_value(db, key)
    if isinstance(prev, dict) and prev.get("mode") == mode:
        return prev

    state = {
        "mode": mode,
        "prev": prev.get("mode") if isinstance(prev, dict) else None,
        "changed_at": datetime.now(timezone.utc).isoformat(),
        # Смены не было (первое наблюдение) — подтверждать нечего.
        "confirmed": not isinstance(prev, dict),
    }
    settings_service.set_value(db, key, state)
    db.commit()
    return state


def state_of(db: Session, printer: Printer) -> dict | None:
    """Последнее наблюдение за режимом подачи (или None, если его ещё не было)."""
    state = settings_service.get_value(db, f"{_STATE_PREFIX}{printer.id}")
    return state if isinstance(state, dict) else None


def pending(db: Session, printer: Printer) -> dict | None:
    """Неподтверждённая смена режима подачи, если она есть."""
    state = settings_service.get_value(db, f"{_STATE_PREFIX}{printer.id}")
    if not isinstance(state, dict) or state.get("confirmed"):
        return None
    return state


def confirm(db: Session, printer: Printer) -> dict | None:
    """Пользователь подтвердил, какие катушки стоят: снять флаг."""
    key = f"{_STATE_PREFIX}{printer.id}"
    state = settings_service.get_value(db, key)
    if not isinstance(state, dict):
        return None
    state = {**state, "confirmed": True}
    settings_service.set_value(db, key, state)
    db.commit()
    return state


def set_mode(db: Session, printer: Printer, mode: str) -> Printer:
    """Сохранить выбор режима и привести слоты в соответствие.

    Слоты не удаляем никогда — на них висит история назначений и расход печатей.
    Прямая подача оставляет активной только внешнюю катушку (слот 0), а у
    принтера без хаба — слот 1, который и есть держатель. Возврат к мультиподаче
    включает гейты и гасит держатель: катушка на нём может остаться стоять, но
    печать идёт не с неё. Режим auto слоты не трогает — там решение принимает
    телеметрия, и молча гасить слоты на сетевом сбое было бы хуже, чем оставить
    лишние.
    """
    if mode not in MODES:
        raise ValueError(f"Неизвестный режим подачи: {mode}")
    printer.capabilities = {**(printer.capabilities or {}), "feed_mode": mode}

    if mode == "direct" and has_hub(printer):
        slot_service.ensure_holder(db, printer)

    if mode in ("direct", "mmu"):
        slots = list(
            db.scalars(select(PrinterSlot).where(PrinterSlot.printer_id == printer.id))
        )
        holder = any(s.slot_index == slot_service.HOLDER_INDEX for s in slots)
        for slot in slots:
            if mode == "mmu":
                slot.is_active = slot.slot_index != slot_service.HOLDER_INDEX
            elif holder:
                slot.is_active = slot.slot_index == slot_service.HOLDER_INDEX
            else:
                slot.is_active = slot.slot_index <= 1

    # Автоопределение начинает наблюдение заново: прежний счётчик относится к
    # прошлому состоянию железа.
    row = db.get(AppSetting, f"{_PROBE_PREFIX}{printer.id}")
    if row is not None:
        db.delete(row)
    db.commit()
    db.refresh(printer)
    return printer
