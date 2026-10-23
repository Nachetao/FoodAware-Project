"""Clave interna de POST /ingest/runs (header X-Clave-Ingesta).

Cerrado por defecto: sin INGESTA_CLAVE definida, el endpoint responde 403
siempre. La respuesta es la misma si falta el header, si la clave no
coincide o si no hay clave configurada, para no revelar cuál es el caso.
"""
import hashlib
import hmac
import logging
from typing import Annotated, Optional

from fastapi import Header

from app.core.config import settings
from app.core.errores import Prohibido

logger = logging.getLogger(__name__)

HEADER_CLAVE_INGESTA = "X-Clave-Ingesta"


def exigir_clave_ingesta(
    clave: Annotated[Optional[str], Header(
        alias=HEADER_CLAVE_INGESTA,
        description="Clave interna (variable INGESTA_CLAVE del servicio).",
    )] = None,
) -> None:
    configurada = settings.ingesta_clave
    esperada = configurada.get_secret_value() if configurada else ""
    if not esperada or clave is None or not _iguales(clave, esperada):
        logger.warning("POST /ingest/runs rechazado: clave ausente o inválida")
        raise Prohibido("Se requiere una clave de ingesta válida")


def _iguales(recibida: str, esperada: str) -> bool:
    # Se comparan los SHA-256 en tiempo constante: así tampoco se filtra el
    # largo de la clave.
    return hmac.compare_digest(
        hashlib.sha256(recibida.encode("utf-8")).digest(),
        hashlib.sha256(esperada.encode("utf-8")).digest(),
    )
