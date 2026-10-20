from typing import Annotated, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.tipos import FechaUTC


class SolicitudIngesta(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    pais: str = Field(
        "chile",
        min_length=2,
        max_length=50,
        pattern=r"^[a-z]+(-[a-z]+)*$",
        description="País como etiqueta de Open Food Facts.",
        examples=["chile"],
    )
    categorias: List[Annotated[str, Field(min_length=2, max_length=100)]] = (
        Field(
            default_factory=list,
            max_length=20,
            description="Categorías de Open Food Facts; vacío = todas.",
            examples=[["en:dairies", "en:breakfast-cereals"]],
        )
    )
    max_productos: int = Field(
        100,
        ge=1,
        le=500,
        description="Máximo de productos a recuperar.",
        examples=[100],
    )


class ResumenIngesta(BaseModel):
    run_id: UUID = Field(examples=["3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b"])
    inicio: FechaUTC = Field(examples=["2026-10-20T14:00:00Z"])
    fin: Optional[FechaUTC] = Field(
        None,
        description="Nulo mientras la ejecución está en curso.",
        examples=["2026-10-20T14:02:30Z"],
    )
    duracion_ms: Optional[int] = Field(None, ge=0, examples=[150000])
    recuperados: int = Field(
        ge=0, description="Productos descargados.", examples=[100]
    )
    validos: int = Field(ge=0, examples=[92])
    invalidos: int = Field(ge=0, examples=[8])
    duplicados: int = Field(
        ge=0,
        description="Válidos descartados por existir ya con el mismo "
        "contenido.",
        examples=[5],
    )
    errores: int = Field(
        ge=0,
        description="Peticiones a la fuente que fallaron.",
        examples=[1],
    )
    estado: Literal[
        "en_curso", "completado", "completado_con_errores", "fallido"
    ] = Field(examples=["completado_con_errores"])

    @model_validator(mode="after")
    def _validar_consistencia(self):
        if self.fin is not None and self.fin < self.inicio:
            raise ValueError("fin no puede ser anterior a inicio")
        if self.estado != "en_curso" and self.fin is None:
            raise ValueError("una ejecución terminada debe tener fin")
        if self.validos + self.invalidos > self.recuperados:
            raise ValueError("validos + invalidos no puede superar "
                             "recuperados")
        if self.duplicados > self.validos:
            raise ValueError("duplicados no puede superar validos")
        return self
