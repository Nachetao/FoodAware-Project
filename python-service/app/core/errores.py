import logging
from typing import Dict, Optional

from fastapi import FastAPI, Request
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.request_id import HEADER_REQUEST_ID
from app.schemas.enums import CodigoError
from app.schemas.sistema import RespuestaError

logger = logging.getLogger(__name__)

# Rutas que NestJS ya consume: conservan los errores nativos de FastAPI.
RUTAS_LEGADAS = {"/", "/health", "/analizar"}


class ErrorAPI(Exception):
    status_code = 500
    codigo = CodigoError.INTERNAL_ERROR

    def __init__(self, mensaje: str):
        super().__init__(mensaje)
        self.mensaje = mensaje


class NoEncontrado(ErrorAPI):
    status_code = 404
    codigo = CodigoError.NOT_FOUND


class SolicitudInvalida(ErrorAPI):
    status_code = 422
    codigo = CodigoError.VALIDATION_ERROR


class FuenteNoDisponible(ErrorAPI):
    status_code = 503
    codigo = CodigoError.SOURCE_UNAVAILABLE


class FuenteTimeout(ErrorAPI):
    status_code = 504
    codigo = CodigoError.SOURCE_TIMEOUT


_DESCRIPCIONES = {
    404: "Recurso no encontrado (NOT_FOUND).",
    422: "Parámetros o cuerpo inválidos (VALIDATION_ERROR).",
    500: "Error interno (INTERNAL_ERROR).",
    503: "Open Food Facts no disponible (SOURCE_UNAVAILABLE).",
    504: "Open Food Facts no respondió a tiempo (SOURCE_TIMEOUT).",
}


def respuestas_error(*status_codes: int) -> Dict[int, dict]:
    """Bloque responses= de OpenAPI; siempre incluye el 500."""
    return {
        codigo: {
            "model": RespuestaError,
            "description": _DESCRIPCIONES[codigo],
        }
        for codigo in sorted({*status_codes, 500})
    }


def respuesta_error(
    request: Request,
    status_code: int,
    codigo: CodigoError,
    mensaje: str,
    headers: Optional[Dict[str, str]] = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "desconocido")
    cuerpo = RespuestaError(
        error={"codigo": codigo, "mensaje": mensaje, "request_id": request_id}
    )
    # Se repiten aquí porque los 500 no pasan por RequestIdMiddleware.
    headers = {**(headers or {}), HEADER_REQUEST_ID: request_id}
    return JSONResponse(
        cuerpo.model_dump(mode="json"),
        status_code=status_code,
        headers=headers,
    )


async def _manejar_error_api(request: Request, exc: ErrorAPI):
    if exc.status_code >= 500:
        logger.warning("%s: %s", exc.codigo.value, exc.mensaje)
    return respuesta_error(request, exc.status_code, exc.codigo, exc.mensaje)


async def _manejar_validacion(request: Request, exc: RequestValidationError):
    if request.url.path in RUTAS_LEGADAS:
        return await request_validation_exception_handler(request, exc)
    detalles = "; ".join(
        f"{'.'.join(str(parte) for parte in error['loc'])}: {error['msg']}"
        for error in exc.errors()
    )
    return respuesta_error(
        request,
        422,
        CodigoError.VALIDATION_ERROR,
        f"Solicitud inválida: {detalles}",
    )


async def _manejar_http(request: Request, exc: StarletteHTTPException):
    if request.url.path in RUTAS_LEGADAS:
        return await http_exception_handler(request, exc)
    if exc.status_code == 404:
        codigo = CodigoError.NOT_FOUND
        mensaje = f"Ruta no encontrada: {request.url.path}"
    elif exc.status_code >= 500:
        codigo, mensaje = CodigoError.INTERNAL_ERROR, str(exc.detail)
    else:
        codigo, mensaje = CodigoError.VALIDATION_ERROR, str(exc.detail)
    return respuesta_error(
        request, exc.status_code, codigo, mensaje, headers=exc.headers
    )


async def _manejar_inesperado(request: Request, exc: Exception):
    logger.exception("Error no controlado", exc_info=exc)
    return respuesta_error(
        request, 500, CodigoError.INTERNAL_ERROR, "Error interno del servicio"
    )


def registrar_manejadores_error(app: FastAPI) -> None:
    app.add_exception_handler(ErrorAPI, _manejar_error_api)
    app.add_exception_handler(RequestValidationError, _manejar_validacion)
    app.add_exception_handler(StarletteHTTPException, _manejar_http)
    app.add_exception_handler(Exception, _manejar_inesperado)
