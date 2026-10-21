from typing import Dict, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.enums import CodigoError
from app.schemas.tipos import FechaUTC

EstadoDependencia = Literal["ok", "degradado", "error", "no_verificado"]


class DetalleCache(BaseModel):
    productos: Optional[int] = Field(
        None, ge=0, description="Productos en la caché; nulo si no responde.",
        examples=[812],
    )


class DetalleIndice(BaseModel):
    cargado: bool = Field(
        description="El índice de búsqueda ya se construyó desde la caché.",
        examples=[True],
    )
    productos: int = Field(ge=0, examples=[812])


class DetalleOpenFoodFacts(BaseModel):
    ultima_ingesta: Optional[
        Literal["completado", "completado_con_errores", "fallido"]
    ] = Field(None, description="Estado de la última ingesta terminada; "
              "nulo si nunca hubo una.", examples=["completado"])
    ultima_ingesta_fin: Optional[FechaUTC] = Field(
        None, examples=["2026-10-20T14:02:30Z"]
    )
    ultima_falla: Optional[FechaUTC] = Field(
        None, description="Última falla registrada de la fuente.",
        examples=["2026-10-20T13:10:00Z"],
    )


class DetalleSalud(BaseModel):
    cache: DetalleCache
    indice: DetalleIndice
    openfoodfacts: DetalleOpenFoodFacts


class RespuestaSalud(BaseModel):
    estado: Literal["ok", "degradado", "error"] = Field(examples=["ok"])
    servicio: str = Field(examples=["python-service"])
    version: str = Field(examples=["1.0.0"])
    verificado_en: FechaUTC = Field(examples=["2026-10-20T14:30:00Z"])
    dependencias: Dict[str, EstadoDependencia] = Field(
        default_factory=dict,
        description="Estado de cada dependencia: cache, indice y "
        "openfoodfacts.",
        examples=[{"cache": "ok", "indice": "ok", "openfoodfacts": "ok"}],
    )
    detalle: Optional[DetalleSalud] = Field(
        None, description="Datos con que se decidió cada estado; GET /health "
        "siempre lo incluye.",
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
