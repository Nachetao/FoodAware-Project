from pydantic import BaseModel, Field

from app.schemas.tipos import Porcentaje, Proporcion


class MetricasCalidad(BaseModel):
    porcentaje_validos: Porcentaje = Field(
        description="Válidos sobre recuperados en las ingestas terminadas.",
        examples=[92.0],
    )
    porcentaje_duplicados: Porcentaje = Field(
        description="Duplicados sobre válidos en las ingestas terminadas.",
        examples=[5.0],
    )
    cobertura_ingredientes: Porcentaje = Field(
        description="Porcentaje de productos recuperados con ingredientes "
        "utilizables tras la limpieza.",
        examples=[87.5],
    )
    antiguedad_promedio_horas: float = Field(
        ge=0,
        description="Horas promedio desde la última verificación de cada "
        "producto contra la fuente.",
        examples=[18.2],
    )
    total_productos: int = Field(
        ge=0, description="Productos válidos en la caché.", examples=[1240]
    )


class MetricasEvaluacion(BaseModel):
    k: int = Field(ge=1, le=50, examples=[5])
    precision_at_k: Proporcion = Field(examples=[0.8])
    recall_at_k: Proporcion = Field(examples=[0.65])
    consultas_evaluadas: int = Field(ge=0, examples=[20])
    tiempo_promedio_ms: float = Field(ge=0, examples=[14.3])
