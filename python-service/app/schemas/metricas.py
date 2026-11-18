from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.tipos import Porcentaje, Proporcion

ORIGEN_ETIQUETADO = (
    "Propuesto con asistencia de IA leyendo solo los ingredientes y "
    "revisado por el equipo; ver docs/recuperacion-y-evaluacion.md."
)


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


# --- GET /metrics/evaluation/adaptive ----------------------------------------
# Definiciones en app/evaluacion/adaptativa.py. Las tasas son nulas cuando
# no están definidas (no hay productos en el denominador).

VeredictoEvaluado = Literal["apto", "apto_con_advertencia", "no_apto"]


class ResumenEtiquetado(BaseModel):
    productos_revisados: int = Field(
        ge=0, description="Productos del etiquetado manual con "
        "revisado_por_equipo en true.", examples=[30])
    productos_evaluados: int = Field(
        ge=0, description="Revisados que están en el índice.",
        examples=[30])
    no_encontrados: List[str] = Field(
        default_factory=list,
        description="Revisados que no están en el índice (no se evalúan).")
    origen: str = Field(
        description="Cómo se hizo el etiquetado.",
        examples=[ORIGEN_ETIQUETADO])


class DeteccionAlergenos(BaseModel):
    productos: int = Field(ge=0, examples=[30])
    verdaderos_positivos: int = Field(ge=0, examples=[52])
    falsos_positivos: int = Field(ge=0, examples=[4])
    falsos_negativos: int = Field(ge=0, examples=[3])
    precision: Optional[Proporcion] = Field(
        None, description="Marcados por el sistema que son correctos.",
        examples=[0.93])
    exhaustividad: Optional[Proporcion] = Field(
        None, description="Alérgenos reales que el sistema marca.",
        examples=[0.95])


class EvaluacionDeteccion(BaseModel):
    alergenos: DeteccionAlergenos
    trazas: DeteccionAlergenos = Field(
        description="Trazas del sistema sin las que ya son ingrediente.")


class EvaluacionPerfilPrueba(BaseModel):
    perfil: str = Field(examples=["alergia a lácteos"])
    modo: Literal["normal", "estricto"] = Field(examples=["normal"])
    productos: int = Field(
        ge=0, description="Con alérgenos etiquetados.", examples=[30])
    contienen: int = Field(
        ge=0, description="Contienen algo que el perfil evita.",
        examples=[11])
    falsos_apto: int = Field(
        ge=0, description="El sistema dice apto y el producto contiene "
        "algo que el perfil evita.", examples=[0])
    tasa_falsos_apto: Optional[Proporcion] = Field(
        None, description="falsos_apto / contienen.", examples=[0.0])
    falsos_apto_por_traza: int = Field(
        ge=0, description="El sistema dice apto y el etiquetado tiene una "
        "traza de algo que el perfil evita.", examples=[0])
    productos_completos: int = Field(
        ge=0, description="Con veredicto esperado conocido.",
        examples=[29])
    falsos_no_apto: int = Field(
        ge=0, description="El sistema dice no_apto y el esperado no lo "
        "es.", examples=[1])
    tasa_falsos_no_apto: Optional[Proporcion] = Field(
        None, description="falsos_no_apto / productos cuyo esperado no es "
        "no_apto.", examples=[0.05])
    coincidencias: int = Field(
        ge=0, description="Veredicto del sistema igual al esperado.",
        examples=[24])
    matriz: Dict[VeredictoEvaluado, Dict[VeredictoEvaluado, int]] = Field(
        description="Veredicto esperado (filas) contra el del sistema "
        "(columnas).")


class ComparacionConsultaRestriccion(BaseModel):
    id: str = Field(examples=["chocolate-sin-leche"])
    consulta: str = Field(examples=["chocolate sin leche"])
    relevantes: int = Field(ge=0, examples=[6])
    precision_base: Proporcion = Field(examples=[0.0])
    precision_personalizada: Proporcion = Field(examples=[0.6])
    no_aptos_top_base: int = Field(ge=0, examples=[5])
    no_aptos_top_personalizado: int = Field(ge=0, examples=[0])


class EvaluacionBusquedaAdaptativa(BaseModel):
    k: int = Field(ge=1, le=50, examples=[5])
    consultas_evaluadas: int = Field(
        ge=0, description="Consultas con restricción con al menos un "
        "relevante; entran en los promedios.", examples=[8])
    precision_base: Proporcion = Field(
        description="Promedio macro de Precision@K de GET /search.",
        examples=[0.2])
    precision_personalizada: Proporcion = Field(
        description="Promedio macro de Precision@K de POST "
        "/search/personalized (perfil vacío, modo filtrar).",
        examples=[0.6])
    no_aptos_top_base: int = Field(
        ge=0, description="Productos no_apto en el top K, sumando las "
        "consultas.", examples=[25])
    no_aptos_top_personalizado: int = Field(ge=0, examples=[0])
    consultas: List[ComparacionConsultaRestriccion]


class MetricasEvaluacionAdaptativa(BaseModel):
    etiquetado: ResumenEtiquetado
    deteccion: EvaluacionDeteccion
    veredictos: List[EvaluacionPerfilPrueba]
    busqueda: EvaluacionBusquedaAdaptativa
