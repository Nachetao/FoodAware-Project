import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logs import fijar_request_id, restaurar_request_id

HEADER_REQUEST_ID = "X-Request-ID"
HEADER_TIEMPO_RESPUESTA = "X-Response-Time-ms"

# Solo se reutiliza un ID entrante con formato seguro para logs y headers.
_FORMATO_VALIDO = re.compile(r"[A-Za-z0-9._-]{1,128}")

logger = logging.getLogger("app.acceso")


def milisegundos_desde(inicio: float) -> float:
    return round((time.perf_counter() - inicio) * 1000, 3)


def tiempo_respuesta(inicio: float) -> str:
    """Valor del header X-Response-Time-ms."""
    return f"{milisegundos_desde(inicio):.3f}"


class RequestIdMiddleware:
    """Propaga X-Request-ID o genera un uuid4, y lo deja en el contexto de
    los logs de la petición.

    También agrega X-Response-Time-ms (tiempo hasta enviar los headers) y
    escribe un log de acceso por petición al terminar de enviar la
    respuesta, antes de las tareas en segundo plano.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inicio = time.perf_counter()
        recibido = Headers(scope=scope).get(HEADER_REQUEST_ID, "")
        valido = _FORMATO_VALIDO.fullmatch(recibido)
        request_id = recibido if valido else str(uuid.uuid4())
        estado = scope.setdefault("state", {})
        estado["request_id"] = request_id
        estado["inicio"] = inicio
        token = fijar_request_id(request_id)
        codigo_estado = 500
        registrado = False

        def registrar_acceso() -> None:
            nonlocal registrado
            registrado = True
            duracion = milisegundos_desde(inicio)
            logger.info(
                "%s %s %d en %.1f ms", scope["method"], scope["path"],
                codigo_estado, duracion,
                extra={
                    "evento": "acceso_http",
                    "metodo": scope["method"],
                    "ruta": scope["path"],
                    "codigo_estado": codigo_estado,
                    "duracion_ms": duracion,
                },
            )

        async def enviar(message: Message) -> None:
            nonlocal codigo_estado
            if message["type"] == "http.response.start":
                codigo_estado = message["status"]
                headers = MutableHeaders(scope=message)
                headers[HEADER_REQUEST_ID] = request_id
                headers[HEADER_TIEMPO_RESPUESTA] = tiempo_respuesta(inicio)
            await send(message)
            if (message["type"] == "http.response.body"
                    and not message.get("more_body", False)):
                registrar_acceso()

        try:
            await self.app(scope, receive, enviar)
        except Exception:
            # El 500 lo responde ServerErrorMiddleware, que envuelve a este.
            # El request_id queda en el contexto: el manejador del 500 y
            # uvicorn registran el error después, en la misma tarea.
            if not registrado:
                registrar_acceso()
            raise
        restaurar_request_id(token)
