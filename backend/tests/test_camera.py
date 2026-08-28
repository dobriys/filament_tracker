"""Адрес камеры и разбор её ответа — без живого принтера."""
import httpx
import pytest

from app.services import camera
from app.services.moonraker import parse_webcams

JPEG = camera.JPEG_SOI + b"body" + camera.JPEG_EOI


def test_webcam_urls_prefers_snapshot_and_skips_disabled():
    cams = [
        {"name": "off", "snapshot_url": "/off?action=snapshot", "enabled": False},
        {"name": "cam", "snapshot_url": "/webcam?action=snapshot",
         "stream_url": "/webcam?action=stream", "enabled": True},
    ]
    assert camera.webcam_urls(cams) == ["/webcam?action=snapshot", "/webcam?action=stream"]


def test_parse_webcams_survives_old_moonraker():
    assert parse_webcams({"error": "Not Found"}) == []
    assert parse_webcams({"result": {"webcams": [{"name": "cam"}]}}) == [{"name": "cam"}]


def test_absolute_keeps_full_url_and_joins_relative():
    assert camera.absolute("http://p:7125", "http://cam/snap") == "http://cam/snap"
    assert camera.absolute("http://p:7125/", "/webcam/?action=snapshot") == (
        "http://p:7125/webcam/?action=snapshot"
    )
    assert camera.absolute("", "/webcam/") is None


def test_candidates_try_both_moonraker_port_and_plain_host():
    # У классической сборки Moonraker слушает :7125, а камеру раздаёт nginx на 80.
    assert camera.candidates("http://p:7125", ["/webcam/?action=snapshot"]) == [
        "http://p:7125/webcam/?action=snapshot",
        "http://p/webcam/?action=snapshot",
    ]
    # Порта нет (или он и так стандартный) — второй базы не появляется.
    assert camera.candidates("http://p", ["/webcam/"]) == ["http://p/webcam/"]
    assert camera.candidates("http://p:80", ["/webcam/"]) == ["http://p:80/webcam/"]


def test_first_jpeg_frame_cuts_frame_out_of_mjpeg_stream():
    stream = b"--boundary\r\nContent-Type: image/jpeg\r\n\r\n" + JPEG + b"\r\n--boundary\r\n"
    assert camera.first_jpeg_frame(stream) == JPEG
    # Кадр ещё не дочитан — ждём следующих байтов, а не отдаём обрезок.
    assert camera.first_jpeg_frame(stream[:20]) is None


def test_looks_like_image_rejects_html_error_page():
    assert camera.looks_like_image(JPEG)
    assert camera.looks_like_image(camera.PNG_MAGIC + b"...")
    assert not camera.looks_like_image(b"<html>404</html>")


def _fetch(body: bytes, content_type: str, *, api_key=None, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen["api_key"] = request.headers.get("X-Api-Key")
        return httpx.Response(200, content=body, headers={"content-type": content_type})

    return camera.fetch(
        "http://p/webcam", api_key=api_key, transport=httpx.MockTransport(handler)
    )


def test_fetch_returns_plain_snapshot():
    assert _fetch(JPEG, "image/jpeg") == JPEG


def test_fetch_takes_first_frame_of_stream():
    body = b"--b\r\n\r\n" + JPEG + b"\r\n--b\r\n\r\n" + camera.JPEG_SOI + b"second"
    assert _fetch(body, "multipart/x-mixed-replace; boundary=b") == JPEG


def test_fetch_ignores_non_image_answer():
    assert _fetch(b"<html>no camera here</html>", "text/html") is None


def test_fetch_sends_api_key():
    seen = {}
    _fetch(JPEG, "image/jpeg", api_key="secret", seen=seen)
    assert seen["api_key"] == "secret"


def test_fetch_propagates_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with pytest.raises(httpx.HTTPStatusError):
        camera.fetch("http://p/webcam", transport=httpx.MockTransport(handler))
