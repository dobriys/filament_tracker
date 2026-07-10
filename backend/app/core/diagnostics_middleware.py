"""ASGI-middleware диагностического журнала.

Пишет каждый изменяющий запрос (метод, путь, код, длительность, пользователь,
тело — без секретов) и необработанные исключения. Реализован как «чистый» ASGI
(а не BaseHTTPMiddleware), чтобы без потерь читать тело запроса и код/тело
ответа, не ломая поток данных для обработчиков ниже.

Когда журнал выключен — накладных расходов нет: запрос проходит насквозь.
"""
import json
import time

from app.core.security import decode_access_token
from app.services import diagnostics

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
_MAX_BODY = 8 * 1024      # сколько байт тела запроса буферизуем
_MAX_ERR_BODY = 4 * 1024  # сколько байт тела ответа буферизуем при ошибке


def _user_from_headers(headers) -> str | None:
    auth = None
    for k, v in headers:
        if k == b"authorization":
            auth = v.decode("latin-1")
            break
    if not auth or not auth.lower().startswith("bearer "):
        return None
    try:
        return decode_access_token(auth[7:])
    except Exception:  # noqa: BLE001
        return None


class DiagnosticsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not diagnostics.is_enabled():
            return await self.app(scope, receive, send)

        method = scope.get("method", "")
        path = scope.get("path", "")
        # Свои же служебные вызовы не логируем (иначе шум от опроса/отчётов).
        interesting = method in _MUTATING and not path.startswith("/api/diagnostics")
        if not interesting:
            # Всё равно ловим необработанные исключения, но без буферизации тел.
            try:
                return await self.app(scope, receive, send)
            except Exception as exc:  # noqa: BLE001
                diagnostics.record_exception(
                    exc, method=method, path=path,
                    user_email=_user_from_headers(scope.get("headers", [])),
                )
                raise

        headers = scope.get("headers", [])
        content_type = ""
        for k, v in headers:
            if k == b"content-type":
                content_type = v.decode("latin-1")
                break

        req_body = bytearray()
        req_truncated = False

        async def recv():
            nonlocal req_truncated
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                if len(req_body) < _MAX_BODY:
                    req_body.extend(chunk[: _MAX_BODY - len(req_body)])
                    if len(req_body) >= _MAX_BODY:
                        req_truncated = True
            return message

        status_holder = {"status": None}
        err_body = bytearray()

        async def snd(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
            elif message["type"] == "http.response.body" and status_holder["status"] and status_holder["status"] >= 400:
                if len(err_body) < _MAX_ERR_BODY:
                    err_body.extend(message.get("body", b"")[: _MAX_ERR_BODY - len(err_body)])
            await send(message)

        start = time.monotonic()
        try:
            await self.app(scope, recv, snd)
        except Exception as exc:  # noqa: BLE001
            diagnostics.record_exception(
                exc, method=method, path=path,
                user_email=_user_from_headers(headers),
            )
            raise

        duration_ms = int((time.monotonic() - start) * 1000)
        status = status_holder["status"]
        self._log(method, path, status, duration_ms, headers, content_type,
                  bytes(req_body), req_truncated, bytes(err_body))

    @staticmethod
    def _log(method, path, status, duration_ms, headers, content_type, req_body, req_truncated, err_body):
        context: dict = {}

        # Тело запроса (json / форма), крупные загрузки не тянем.
        if "multipart/form-data" in content_type:
            context["body"] = "<multipart upload>"
        elif req_body:
            text = req_body.decode("utf-8", "replace")
            if "application/json" in content_type:
                try:
                    context["body"] = json.loads(text)
                except ValueError:
                    context["body"] = text
            else:
                context["body"] = text
            if req_truncated:
                context["body_truncated"] = True

        message = None
        if status and status >= 400 and err_body:
            text = err_body.decode("utf-8", "replace")
            try:
                detail = json.loads(text).get("detail")
                message = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
            except (ValueError, AttributeError):
                message = text

        level = "error" if (status or 0) >= 500 else "warning" if (status or 0) >= 400 else "info"
        diagnostics.event(
            level,
            "http",
            message,
            category="request",
            action=f"{method} {path}",
            method=method,
            path=path,
            status=status,
            duration_ms=duration_ms,
            user_email=_user_from_headers(headers),
            context=context or None,
        )
