from typing import Dict, Literal

from pydantic import BaseModel, Field

from app.schemas.enums import CodigoError
from app.schemas.tipos import FechaUTC


# Aún no lo usa GET /health, que mantiene {"status", "service"}.
class RespuestaSalud(BaseModel):
    estado: Literal["ok", "degradado", "error"] = Field(examples=["ok"])
    servicio: str = Field(examples=["foodaware-ia"])
    version: str = Field(examples=["1.0.0"])
    verificado_en: FechaUTC = Field(examples=["2026-10-20T14:30:00Z"])
    dependencias: Dict[str, Literal["ok", "error", "no_verificado"]] = (
        Field(
            default_factory=dict,
            description="Estado de cada dependencia externa.",
            examples=[{"openfoodfacts": "ok"}],
        )
    )


class DetalleError(BaseModel):
    codigo: CodigoError = Field(examples=["NOT_FOUND"])
    mensaje: str = Field(
        min_length=1, examples=["Producto 7802800716999 no encontrado"]
    )
    request_id: str = Field(
        min_length=1,
        max_length=128,
        description="Valor del header X-Request-ID de la petición.",
        examples=["3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b"],
    )


class RespuestaError(BaseModel):
    error: DetalleError
