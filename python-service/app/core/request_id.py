import re
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER_REQUEST_ID = "X-Request-ID"

# Solo se reutiliza un ID entrante con formato seguro para logs y headers.
_FORMATO_VALIDO = re.compile(r"[A-Za-z0-9._-]{1,128}")


class RequestIdMiddleware:
    """Propaga X-Request-ID o genera un uuid4."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        recibido = Headers(scope=scope).get(HEADER_REQUEST_ID, "")
        valido = _FORMATO_VALIDO.fullmatch(recibido)
        request_id = recibido if valido else str(uuid.uuid4())
        estado = scope.setdefault("state", {})
        estado["request_id"] = request_id

        async def enviar(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers[HEADER_REQUEST_ID] = request_id
            await send(message)

        await self.app(scope, receive, enviar)
