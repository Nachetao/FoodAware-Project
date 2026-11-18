"""Clave compartida entre NestJS y FastAPI (header X-Clave-Servicio).

Protege los endpoints que consume el backend. Quedan fuera /health (lo usan
Render y Docker como health check), / y la documentación, y POST
/ingest/runs, que tiene su propia clave (ver app.core.clave_ingesta).

Cerrado por defecto: con CLAVE_SERVICIO_OBLIGATORIA=true (el valor por
defecto), sin CLAVE_SERVICIO definida responde 403 siempre. La respuesta es
la misma si falta el header, si la clave no coincide o si no hay clave
configurada, para no revelar cuál es el caso.

Transición: con CLAVE_SERVICIO_OBLIGATORIA=false, una petición sin el header
(o con el header vacío) se acepta y queda una advertencia en el log, para
que el backend siga funcionando mientras empieza a enviar la clave. Una
clave que no coincide da 403 igual.
"""
import logging
from typing import Annotated, Optional

from fastapi import Header, Request

from app.core.clave_ingesta import _iguales as iguales_en_tiempo_constante
from app.core.config import settings
from app.core.errores import Prohibido

logger = logging.getLogger(__name__)

HEADER_CLAVE_SERVICIO = "X-Clave-Servicio"
MENSAJE_RECHAZO = "Se requiere una clave de servicio válida"


def exigir_clave_servicio(
    request: Request,
    clave: Annotated[Optional[str], Header(
        alias=HEADER_CLAVE_SERVICIO,
        description="Clave compartida con NestJS (variable CLAVE_SERVICIO "
                    "del servicio).",
    )] = None,
) -> None:
    configurada = settings.clave_servicio
    esperada = configurada.get_secret_value() if configurada else ""
    ruta = request.url.path

    if not clave:
        if settings.clave_servicio_obligatoria:
            _rechazar(ruta, "sin clave")
        logger.warning(
            "Petición sin %s aceptada porque CLAVE_SERVICIO_OBLIGATORIA es "
            "false", HEADER_CLAVE_SERVICIO,
            extra={"evento": "clave_servicio_ausente", "ruta": ruta},
        )
        return
    if not esperada or not iguales_en_tiempo_constante(clave, esperada):
        _rechazar(ruta, "clave inválida o sin clave configurada")


def _rechazar(ruta: str, motivo: str) -> None:
    # Nunca se registra la clave recibida.
    logger.warning("Petición rechazada: %s", motivo,
                   extra={"evento": "clave_servicio_rechazada",
                          "ruta": ruta})
    raise Prohibido(MENSAJE_RECHAZO)
