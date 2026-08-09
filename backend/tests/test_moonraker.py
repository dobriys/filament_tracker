import httpx
import pytest

from app.services.moonraker import (
    MoonrakerClient,
    job_to_parsed,
    parse_history,
    parse_light,
    parse_status,
    parse_thumbnails,
    pick_thumbnail,
    thumbnail_path,
)

# Реальное задание Anycubic Kobra S1 (Rinkhals) — пофиловый расход в граммах.
KOBRA_JOB = {
    "job_id": "0000D9",
    "filename": ".3mf_temp/plate(01)_PLA.gcode",
    "status": "completed",
    "filament_used": 43092.0,
    "metadata": {
        "slicer": "AnycubicSlicerNext",
        "slicer_version": "1.4.1.1",
        "nozzle_diameter": 0.4,
        "estimated_time": 24517,
        "filament_type": "PLA;PLA;PLA;PLA",
        "filament_colors": ["#7F868A", "#B81B0E", "#FFFFFF", "#010101"],
        "filament_weight_total": 127.75,
        "filament_weights": [0.0, 0.0, 127.75, 0.0],
    },
}


def test_job_to_parsed_per_tool_grams():
    p = job_to_parsed(KOBRA_JOB)
    assert p["slicer_name"] == "AnycubicSlicerNext"
    assert p["total_filament_used_g"] == 127.75
    assert p["tool_count"] == 4
    assert [t["used_g"] for t in p["tools"]] == [0.0, 0.0, 127.75, 0.0]
    assert p["tools"][2]["color_hex"] == "#FFFFFF"
    assert p["tools"][2]["material"] == "PLA"
    assert p["estimated_print_time_sec"] == 24517


def test_job_to_parsed_interrupted_uses_actual_length():
    """Печать остановили вручную: веса слайсера — от всей печати, брать нельзя."""
    p = job_to_parsed({**KOBRA_JOB, "status": "cancelled", "filament_used": 8600.0})
    assert p["total_filament_used_g"] is None
    assert p["total_filament_used_mm"] == 8600.0
    assert p["tool_count"] == 1
    tool = p["tools"][0]
    assert tool["used_g"] is None and tool["used_mm"] == 8600.0
    # Материал и цвет подсказываем из метаданных — они от обрыва не зависят.
    assert tool["material"] == "PLA"
    assert tool["color_hex"] == "#7F868A"


PRINTER_INFO = {
    "result": {
        "state": "ready",
        "state_message": "Printer is ready",
        "hostname": "kobra",
        "software_version": "v0.12.0",
    }
}

STATUS = {
    "result": {
        "eventtime": 1000.0,
        "status": {
            "print_stats": {
                "filename": "benchy.gcode",
                "total_duration": 3600,
                "print_duration": 3500,
                "filament_used": 4200.5,
                "state": "printing",
            },
            "display_status": {"progress": 0.42},
            "heater_bed": {"temperature": 60.0, "target": 60.0},
            "extruder": {"temperature": 210.0, "target": 210.0},
        },
    }
}

HISTORY = {
    "result": {
        "count": 2,
        "jobs": [
            {
                "job_id": "000001",
                "filename": "a.gcode",
                "status": "completed",
                "print_duration": 1200,
                "total_duration": 1300,
                "filament_used": 2500.0,
                "metadata": {"slicer": "OrcaSlicer", "filament_weight_total": 7.5},
            },
            {
                "job_id": "000002",
                "filename": "b.gcode",
                "status": "cancelled",
                "filament_used": 100.0,
                "metadata": {},
            },
        ],
    }
}


def _client_returning(payload, status_code=200, api_key=None):
    def handler(request: httpx.Request) -> httpx.Response:
        # ключ должен прокидываться в заголовок
        if api_key:
            assert request.headers.get("X-Api-Key") == api_key
        return httpx.Response(status_code, json=payload)

    return MoonrakerClient(
        "http://printer.local:7125",
        api_key=api_key,
        transport=httpx.MockTransport(handler),
    )


def test_test_connection_ok_and_sends_api_key():
    c = _client_returning(PRINTER_INFO, api_key="secret123")
    res = c.test_connection()
    assert res["ok"] is True
    assert "ready" in res["detail"]
    assert res["info"]["hostname"] == "kobra"


def test_test_connection_unauthorized():
    c = _client_returning({"error": "unauthorized"}, status_code=401)
    res = c.test_connection()
    assert res["ok"] is False
    assert "401" in res["detail"]


def test_print_control_posts_to_moonraker():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        return httpx.Response(200, json={"result": "ok"})

    c = MoonrakerClient("http://printer.local:7125", transport=httpx.MockTransport(handler))
    for action in ("pause", "resume", "cancel"):
        assert c.print_control(action)["result"] == "ok"
        assert seen == {"method": "POST", "path": f"/printer/print/{action}"}


def test_print_control_rejects_unknown_action():
    c = _client_returning({"result": "ok"})
    with pytest.raises(ValueError):
        c.print_control("shutdown")


def test_reset_print_state_sends_sdcard_reset():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["script"] = request.url.params.get("script")
        return httpx.Response(200, json={"result": "ok"})

    c = MoonrakerClient("http://printer.local:7125", transport=httpx.MockTransport(handler))
    assert c.reset_print_state()["result"] == "ok"
    assert seen["method"] == "POST"
    assert seen["path"] == "/printer/gcode/script"
    assert seen["script"] == "SDCARD_RESET_FILE"


# Реальный ответ Kobra S1 на Rinkhals: метаданные задания с миниатюрами.
FILE_METADATA = {
    "result": {
        "filename": ".3mf_temp/stand_plate(01)_PLA.gcode",
        "thumbnails": [
            {"width": 32, "height": 32, "size": 436,
             "relative_path": ".thumbs/stand_plate(01)_PLA-32x32.png"},
            {"width": 512, "height": 512, "size": 5297,
             "relative_path": ".thumbs/stand_plate(01)_PLA-512x512.png"},
            {"width": 230, "height": 110, "size": 3429,
             "relative_path": ".thumbs/stand_plate(01)_PLA-230x110.png"},
        ],
    }
}

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def test_parse_thumbnails_skips_entries_without_path():
    thumbs = parse_thumbnails(FILE_METADATA)
    assert [t["width"] for t in thumbs] == [32, 512, 230]
    assert parse_thumbnails({"result": {"thumbnails": [{"width": 32}]}}) == []
    assert parse_thumbnails({"result": {}}) == []


def test_pick_thumbnail_prefers_camera_render_over_top_view():
    # У Anycubic квадратные картинки — вид сверху для файлового менеджера,
    # деталь на них не узнать; изометрия лежит в широкой 230×110.
    best = pick_thumbnail(parse_thumbnails(FILE_METADATA))
    assert (best["width"], best["height"]) == (230, 110)


def test_pick_thumbnail_falls_back_to_largest_square():
    thumbs = [
        {"width": 32, "height": 32, "relative_path": "a.png"},
        {"width": 300, "height": 300, "relative_path": "b.png"},
    ]
    assert pick_thumbnail(thumbs)["relative_path"] == "b.png"
    assert pick_thumbnail([]) is None


def test_pick_thumbnail_takes_largest_of_wide_ones():
    thumbs = [
        {"width": 32, "height": 15, "relative_path": "small.png"},
        {"width": 230, "height": 110, "relative_path": "big.png"},
    ]
    assert pick_thumbnail(thumbs)["relative_path"] == "big.png"


def test_thumbnail_path_is_relative_to_gcode_folder():
    assert thumbnail_path("a/b.gcode", ".thumbs/b.png") == "a/.thumbs/b.png"
    assert thumbnail_path("b.gcode", ".thumbs/b.png") == ".thumbs/b.png"


def test_get_thumbnail_returns_data_url():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/server/files/metadata":
            seen["filename"] = request.url.params.get("filename")
            return httpx.Response(200, json=FILE_METADATA)
        seen["image"] = request.url.path
        return httpx.Response(200, content=PNG_BYTES, headers={"content-type": "image/png"})

    c = MoonrakerClient("http://printer.local:7125", transport=httpx.MockTransport(handler))
    thumb = c.get_thumbnail(".3mf_temp/stand_plate(01)_PLA.gcode")
    assert seen["filename"] == ".3mf_temp/stand_plate(01)_PLA.gcode"
    assert seen["image"] == "/server/files/gcodes/.3mf_temp/.thumbs/stand_plate(01)_PLA-230x110.png"
    assert (thumb["width"], thumb["height"]) == (230, 110)
    assert thumb["data_url"].startswith("data:image/png;base64,")


def test_get_thumbnail_none_without_metadata():
    # Старый Moonraker (или временный файл без метаданных) — просто нет превью.
    assert _client_returning({"error": "not found"}, status_code=404).get_thumbnail("a.gcode") is None
    assert _client_returning({"result": {}}).get_thumbnail("a.gcode") is None
    assert _client_returning(FILE_METADATA).get_thumbnail("") is None


def test_get_thumbnail_skips_oversized_image():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/server/files/metadata":
            return httpx.Response(200, json=FILE_METADATA)
        return httpx.Response(200, content=b"0" * (600 * 1024))

    c = MoonrakerClient("http://printer.local:7125", transport=httpx.MockTransport(handler))
    assert c.get_thumbnail(".3mf_temp/stand_plate(01)_PLA.gcode") is None


# Реальный ответ Kobra S1 на Rinkhals: подсветка камеры — shell-девайс.
POWER_DEVICES = {
    "result": {
        "devices": [
            {"device": "chamber_light", "status": "on",
             "locked_while_printing": False, "type": "shell"},
        ]
    }
}


def test_parse_light_finds_chamber_light():
    light = parse_light(POWER_DEVICES["result"]["devices"])
    assert light == {"device": "chamber_light", "on": True, "locked": False}


def test_parse_light_ignores_other_power_devices():
    assert parse_light([{"device": "printer_psu", "status": "on"}]) is None
    assert parse_light([]) is None
    assert parse_light(None) is None


def test_get_light_off_state():
    c = _client_returning(
        {"result": {"devices": [{"device": "led_strip", "status": "off"}]}}
    )
    assert c.get_light() == {"device": "led_strip", "on": False, "locked": False}


def test_get_light_none_when_endpoint_missing():
    # Moonraker без компонента power отвечает 404 — это не ошибка, а «нет подсветки».
    c = _client_returning({"error": "not found"}, status_code=404)
    assert c.get_light() is None


def test_set_light_sends_power_action():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["device"] = request.url.params.get("device")
        seen["action"] = request.url.params.get("action")
        return httpx.Response(200, json={"result": {"chamber_light": "off"}})

    c = MoonrakerClient("http://printer.local:7125", transport=httpx.MockTransport(handler))
    c.set_light("chamber_light", False)
    assert seen == {
        "method": "POST",
        "path": "/machine/device_power/device",
        "device": "chamber_light",
        "action": "off",
    }


def test_test_connection_no_network():
    # несуществующий транспорт -> ConnectError, не должно бросать
    def handler(request):
        raise httpx.ConnectError("refused")

    c = MoonrakerClient("http://nope:7125", transport=httpx.MockTransport(handler))
    res = c.test_connection()
    assert res["ok"] is False


def test_get_status_parsing():
    s = parse_status(STATUS)
    assert s["state"] == "printing"
    assert s["filename"] == "benchy.gcode"
    assert s["filament_used_mm"] == 4200.5
    assert s["progress"] == 0.42
    assert s["nozzle_temp"] == 210.0
    assert s["bed_target"] == 60.0


def test_status_surfaces_error_message():
    payload = {
        "result": {
            "status": {
                "print_stats": {
                    "state": "error",
                    "message": "autoleve_panic_error:error: code = 10011902, "
                    "message = Probe samples exceed samples_tolerance",
                },
            }
        }
    }
    s = parse_status(payload)
    assert s["state"] == "error"
    assert "Probe samples exceed samples_tolerance" in s["message"]


def test_status_message_none_when_absent():
    payload = {"result": {"status": {"print_stats": {"state": "printing"}}}}
    assert parse_status(payload)["message"] is None


def test_status_progress_falls_back_to_virtual_sdcard():
    payload = {
        "result": {
            "status": {
                "print_stats": {"state": "printing", "filename": "benchy.gcode"},
                "display_status": {},
                "virtual_sdcard": {"progress": 0.37},
            }
        }
    }

    assert parse_status(payload)["progress"] == 0.37


# Снято с живого Kobra S1 (Rinkhals) во время автокалибровки стола: прошивка уже
# отдаёт state="printing", но счётчики печати ещё нулевые.
PREPARING = {
    "result": {
        "status": {
            "print_stats": {
                "state": "printing",
                "filename": ".3mf_temp/cube_ABS.gcode",
                "print_duration": 0,
                "filament_used": 0,
                "info": {"current_layer": 0, "total_layer": 150},
            },
            "virtual_sdcard": {
                "progress": 0,
                "remain_time": 3521,
                "total_time": 3521,
                "current_layer": 0,
                "total_layer": 150,
                "filament_type": "ABS",
                "is_homing": 2,
            },
        }
    }
}


def test_status_detects_preparing_phase():
    s = parse_status(PREPARING)
    assert s["state"] == "printing"
    assert s["preparing"] is True
    assert s["total_layer"] == 150
    assert s["remaining_sec"] == 3521.0
    assert s["filament_type"] == "ABS"


def test_status_not_preparing_once_extrusion_starts():
    """Первая же пруж-линия выводит счётчики из нуля — подготовка закончилась."""
    payload = {"result": {"status": {"print_stats": {
        "state": "printing", "print_duration": 1, "filament_used": 50,
    }}}}
    assert parse_status(payload)["preparing"] is False


def test_status_preparing_only_while_printing():
    """В простое нули естественны — подготовкой это считать нельзя."""
    payload = {"result": {"status": {"print_stats": {
        "state": "standby", "print_duration": 0, "filament_used": 0,
    }}}}
    assert parse_status(payload)["preparing"] is False


def test_status_layers_prefer_print_stats_info():
    payload = {"result": {"status": {
        "print_stats": {"state": "printing", "info": {"current_layer": 8, "total_layer": 150}},
        "virtual_sdcard": {"current_layer": 0, "total_layer": 150, "remain_time": 3540},
    }}}
    s = parse_status(payload)
    assert (s["current_layer"], s["total_layer"]) == (8, 150)
    assert s["remaining_sec"] == 3540.0


def test_job_to_parsed_fallback_to_total_length():
    # Moonraker не извлёк пофиловые веса (только size/modified), но есть длина.
    job = {
        "job_id": "0000DE",
        "filename": ".3mf_temp/0703-washer_plate(01)_PLA_0.2_6h40m.gcode",
        "status": "completed",
        "filament_used": 40904.0,
        "metadata": {"size": 123, "modified": 1.0},
    }
    p = job_to_parsed(job)
    assert p["tool_count"] == 1
    assert p["total_filament_used_mm"] == 40904.0
    assert len(p["tools"]) == 1
    tool = p["tools"][0]
    assert tool["tool_index"] == 0
    assert tool["used_g"] is None
    assert tool["used_mm"] == 40904.0
    assert tool["material"] == "PLA"  # из имени файла


def test_job_to_parsed_no_fallback_without_length():
    job = {"job_id": "1", "filename": "x.gcode", "filament_used": 0, "metadata": {}}
    p = job_to_parsed(job)
    assert p["tool_count"] == 0
    assert p["tools"] == []


def test_history_parsing():
    jobs = parse_history(HISTORY)
    assert len(jobs) == 2
    assert jobs[0]["filename"] == "a.gcode"
    assert jobs[0]["slicer"] == "OrcaSlicer"
    assert jobs[0]["filament_total_g"] == 7.5
    assert jobs[1]["status"] == "cancelled"
