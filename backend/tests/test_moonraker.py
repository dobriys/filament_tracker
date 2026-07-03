import httpx

from app.services.moonraker import (
    MoonrakerClient,
    job_to_parsed,
    parse_history,
    parse_status,
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


def test_history_parsing():
    jobs = parse_history(HISTORY)
    assert len(jobs) == 2
    assert jobs[0]["filename"] == "a.gcode"
    assert jobs[0]["slicer"] == "OrcaSlicer"
    assert jobs[0]["filament_total_g"] == 7.5
    assert jobs[1]["status"] == "cancelled"
