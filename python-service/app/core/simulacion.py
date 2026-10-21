from typing import Annotated, Optional

from fastapi import Header

from app.core.config import settings
from app.core.errores import (
    ErrorAPI,
    FuenteNoDisponible,
    FuenteTimeout,
    SolicitudInvalida,
)

_SIMULABLES = {
    "SOURCE_UNAVAILABLE": FuenteNoDisponible,
    "SOURCE_TIMEOUT": FuenteTimeout,
    "INTERNAL_ERROR": ErrorAPI,
}


def simular_error(
    x_simular_error: Annotated[
        Optional[str], Header(include_in_schema=False)
    ] = None,
) -> None:
    """Dependencia de los endpoints del contrato para probar fallas desde
    NestJS.

    Solo actúa con SIMULAR_ERRORES_HABILITADO=true; si no, ignora el header.
    """
    if not settings.simular_errores_habilitado or x_simular_error is None:
        return
    error = _SIMULABLES.get(x_simular_error)
    if error is None:
        permitidos = ", ".join(_SIMULABLES)
        raise SolicitudInvalida(
            f"X-Simular-Error debe ser uno de: {permitidos}"
        )
    raise error(f"Error simulado: {x_simular_error}")
