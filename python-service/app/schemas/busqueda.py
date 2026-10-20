from typing import List, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.producto import Producto


class ResultadoBusqueda(BaseModel):
    producto: Producto
    score: float = Field(
        ge=0,
        description="Puntaje de relevancia; mayor es más relevante.",
        examples=[7.42],
    )
    posicion: int = Field(
        ge=1, description="Posición en el ranking, desde 1.", examples=[1]
    )


class RespuestaBusqueda(BaseModel):
    consulta: str = Field(
        min_length=2,
        max_length=100,
        description="Consulta tal como se procesó.",
        examples=["leche sin lactosa"],
    )
    total: int = Field(
        ge=0,
        description="Total de coincidencias antes de paginar.",
        examples=[23],
    )
    tiempo_ms: float = Field(
        ge=0, description="Tiempo de la búsqueda en ms.", examples=[12.5]
    )
    resultados: List[ResultadoBusqueda] = Field(default_factory=list)
    estado_fuente: Literal["online", "cache"] = Field(
        description="'cache' si la fuente no respondió y se usaron datos "
        "almacenados.",
        examples=["online"],
    )

    @model_validator(mode="after")
    def _resultados_no_superan_total(self):
        if len(self.resultados) > self.total:
            raise ValueError("resultados no puede superar total")
        return self
