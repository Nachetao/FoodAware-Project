"""Logs estructurados en JSON, una línea por evento.

Campos fijos, en este orden (los mismos que usa NestJS para cruzar logs):
timestamp (ISO 8601 UTC), level, service, request_id y message. Después
van logger, los campos extra del evento (`extra=` de logging), run_id si
corresponde y, si hubo, exception con la traza.

request_id sale del contexto (contextvars), sin pasarlo a mano:
RequestIdMiddleware lo fija en cada petición y contexto_ejecucion lo fija
con el run_id en las ingestas en segundo plano. Fuera de ambos es null
(arranque del servicio, planificador esperando la próxima ingesta).
"""
import json
import logging
import re
import sys
from contextlib import contextmanager
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, Optional
from uuid import UUID

SERVICIO = "python-service"

_request_id: ContextVar[Optional[str]] = ContextVar("request_id",
                                                    default=None)
_run_id: ContextVar[Optional[str]] = ContextVar("run_id", default=None)

# Lo que no está aquí llegó en extra= y va como campo del evento.
# color_message lo agrega uvicorn (el mismo mensaje con colores ANSI).
_ATRIBUTOS_PROPIOS = set(vars(logging.LogRecord("", 0, "", 0, "", (), None)))
_ATRIBUTOS_PROPIOS |= {"message", "asctime", "taskName", "color_message",
                       "request_id", "run_id"}

# El User-Agent de OFF lleva el correo de contacto del equipo: ningún correo
# llega a los logs, venga en el mensaje, en un campo extra o en una traza.
_CORREO = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
CORREO_OCULTO = "[correo oculto]"


def request_id_actual() -> Optional[str]:
    return _request_id.get()


def run_id_actual() -> Optional[str]:
    return _run_id.get()


def fijar_request_id(valor: str) -> Token:
    return _request_id.set(valor)


def restaurar_request_id(token: Token) -> None:
    _request_id.reset(token)


@contextmanager
def contexto_ejecucion(run_id: UUID) -> Iterator[None]:
    """Los logs de una ingesta en segundo plano usan su run_id como
    request_id (y como run_id)."""
    valor = str(run_id)
    token_request = _request_id.set(valor)
    token_run = _run_id.set(valor)
    try:
        yield
    finally:
        _run_id.reset(token_run)
        _request_id.reset(token_request)


class FormateadorJSON(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        evento: Dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc)
            .isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "service": SERVICIO,
            # Un extra= explícito tiene prioridad sobre el contexto.
            "request_id": getattr(record, "request_id", _request_id.get()),
            "message": record.getMessage(),
            "logger": record.name,
        }
        evento.update(
            (clave, valor) for clave, valor in vars(record).items()
            if clave not in _ATRIBUTOS_PROPIOS
        )
        run_id = getattr(record, "run_id", _run_id.get())
        if run_id is not None or hasattr(record, "run_id"):
            evento["run_id"] = run_id
        if record.exc_info:
            evento["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            evento["stack"] = self.formatStack(record.stack_info)
        return json.dumps(_ocultar_correos(evento), ensure_ascii=False,
                          default=str)


def _ocultar_correos(valor: Any) -> Any:
    if isinstance(valor, str):
        return _CORREO.sub(CORREO_OCULTO, valor)
    if isinstance(valor, dict):
        return {k: _ocultar_correos(v) for k, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_ocultar_correos(v) for v in valor]
    return valor


class _SalidaEstandar(logging.StreamHandler):
    """Escribe en el sys.stdout vigente al momento de escribir (pytest lo
    reemplaza durante los tests)."""

    @property
    def stream(self):
        return sys.stdout

    @stream.setter
    def stream(self, _valor) -> None:
        pass


def configurar_logs(nivel: str = "INFO") -> None:
    """Deja todos los logs del proceso, incluidos los de uvicorn, en JSON
    por stdout con el nivel `nivel`. Se puede llamar más de una vez."""
    raiz = logging.getLogger()
    for manejador in list(raiz.handlers):
        if isinstance(manejador, _SalidaEstandar):
            raiz.removeHandler(manejador)
    manejador = _SalidaEstandar()
    manejador.setFormatter(FormateadorJSON())
    raiz.addHandler(manejador)
    raiz.setLevel(nivel)
    # uvicorn configura sus loggers con manejadores de texto antes de
    # importar la app; sin ellos, sus logs pasan por el de la raíz.
    for nombre in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(nombre)
        logger.handlers.clear()
        logger.propagate = True
        logger.setLevel(logging.NOTSET)
    # El log de acceso lo escribe RequestIdMiddleware, con request_id y
    # duracion_ms; el de uvicorn quedaría duplicado y sin ellos.
    logging.getLogger("uvicorn.access").disabled = True
    # En DEBUG, httpcore detalla cada paso de cada petición a OFF.
    logging.getLogger("httpcore").setLevel(max(raiz.level, logging.WARNING))
