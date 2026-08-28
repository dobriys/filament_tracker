"""Восстановление бэкапа не теряет полей, которые попали в экспорт (без БД).

Сессия здесь поддельная: restore_backup из БД ничего не читает, ему нужны
только add/flush/get, поэтому связку «колонки экспорта → конструктор модели»
можно проверить обычным тестом. Списки *_COLS сравниваем с данными явно: если
в экспорт добавят колонку, а в restore забудут — тест упадёт, а не промолчит.
"""
import uuid
from datetime import datetime, timezone

from app.models import User
from app.services import backup_service
from app.services.backup_service import PRINTER_COLS, SPOOL_USAGE_COLS, restore_backup


class FakeSession:
    """Минимум, который вызывает restore_backup: id выдаём на flush."""

    def __init__(self):
        self.added = []
        self.by_id = {}
        self.committed = False

    def execute(self, *args, **kwargs):  # снос прежних данных
        return None

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()
            self.by_id[obj.id] = obj

    def get(self, model, ident):
        return self.by_id.get(ident)

    def scalar(self, *args, **kwargs):  # проверка занятости qr_token
        return None

    def commit(self):
        self.committed = True


def _user():
    return User(id=uuid.uuid4(), email="me@example.com", theme="dark")


def _added(db, model):
    return [obj for obj in db.added if isinstance(obj, model)]


PRINTER_ITEM = {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "Anycubic Kobra S1",
    "integration_type": "moonraker",
    "brand": "Anycubic",
    "model": "Kobra S1 Combo",
    "capabilities": {"has_mmu": True, "mmu_slots": 4},
    "cost_params": {
        "printer_price": 45000,
        "power_w": 150,
        "electricity_per_kwh": 5.5,
        "life_years": 5,
        "uptime_pct": 30,
    },
    "moonraker_url": "http://192.168.0.127:80",
    "camera_url": "http://192.168.0.127/webcam/?action=snapshot",
    "is_active": True,
    "notes": "заметка",
}


def test_restore_printer_keeps_every_exported_column():
    assert set(PRINTER_ITEM) >= set(PRINTER_COLS), "в фикстуре нет новой колонки экспорта"
    db = FakeSession()

    result = restore_backup(db, _user(), {"printers": [PRINTER_ITEM]})

    assert result["printers"] == 1
    printer = _added(db, backup_service.Printer)[0]
    for col in PRINTER_COLS:
        assert getattr(printer, col) == PRINTER_ITEM[col], f"поле {col} потеряно"


def test_restore_printer_validates_cost_params():
    db = FakeSession()
    item = dict(PRINTER_ITEM, cost_params={"power_w": "150", "мусор": 1})

    restore_backup(db, _user(), {"printers": [item]})

    printer = _added(db, backup_service.Printer)[0]
    assert printer.cost_params == {"power_w": 150.0}


def test_restore_printer_without_cost_params_leaves_none():
    db = FakeSession()
    item = dict(PRINTER_ITEM)
    item.pop("cost_params")

    restore_backup(db, _user(), {"printers": [item]})

    assert _added(db, backup_service.Printer)[0].cost_params is None


SPOOL_ITEM = {
    "id": "22222222-2222-2222-2222-222222222222",
    "label": "PLA чёрный",
    "current_weight_g": 750,
    "qr_token": "tok",
}
JOB_ITEM = {"id": "33333333-3333-3333-3333-333333333333", "file_name": "part.gcode"}
USAGE_ITEM = {
    "print_job_id": JOB_ITEM["id"],
    "spool_id": SPOOL_ITEM["id"],
    "tool_index": 0,
    "used_g": 12.5,
    "used_mm": 4200.0,
    "confirmed_at": "2026-07-01T10:00:00+00:00",
    "created_at": "2026-06-30T09:00:00+00:00",
}


def test_restore_spool_usage_keeps_every_exported_column():
    assert set(USAGE_ITEM) >= set(SPOOL_USAGE_COLS), "в фикстуре нет новой колонки экспорта"
    db = FakeSession()

    restore_backup(
        db,
        _user(),
        {
            "spools": [SPOOL_ITEM],
            "print_jobs": [JOB_ITEM],
            "print_job_spool_usage": [USAGE_ITEM],
        },
    )

    usage = _added(db, backup_service.PrintJobSpoolUsage)[0]
    assert usage.used_g == USAGE_ITEM["used_g"]
    assert usage.used_mm == USAGE_ITEM["used_mm"]
    assert usage.tool_index == USAGE_ITEM["tool_index"]
    assert usage.confirmed_at == datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    # Дата расхода — это когда списали, а не когда восстановили бэкап.
    assert usage.created_at == datetime(2026, 6, 30, 9, 0, tzinfo=timezone.utc)
