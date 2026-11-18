from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.dependencias import obtener_metricas
from app.core.clave_servicio import exigir_clave_servicio
from app.core.errores import respuestas_error
from app.core.simulacion import simular_error
from app.schemas.metricas import (
    MetricasCalidad,
    MetricasEvaluacion,
    MetricasEvaluacionAdaptativa,
)
from app.services.metricas import ServicioMetricas

# La clave va antes de la simulación: sin ella no se puede forzar un
# error simulado.
router = APIRouter(
    dependencies=[Depends(exigir_clave_servicio), Depends(simular_error)]
)

Metricas = Annotated[ServicioMetricas, Depends(obtener_metricas)]


@router.get(
    "/metrics/quality",
    response_model=MetricasCalidad,
    tags=["metricas"],
    summary="Métricas de calidad de los datos almacenados",
    responses=respuestas_error(403),
)
async def metricas_calidad(metricas: Metricas):
    return await metricas.calidad()


@router.get(
    "/metrics/evaluation",
    response_model=MetricasEvaluacion,
    tags=["metricas"],
    summary="Métricas de evaluación de la búsqueda (Precision@K y "
    "Recall@K)",
    responses=respuestas_error(403),
)
def metricas_evaluacion(metricas: Metricas):
    return metricas.evaluacion()


@router.get(
    "/metrics/evaluation/adaptive",
    response_model=MetricasEvaluacionAdaptativa,
    tags=["metricas"],
    summary="Evaluación de la capacidad adaptativa contra la versión base",
    description="Veredictos contra el etiquetado manual (falsos apto y no "
                "apto por perfil de prueba y modo), detección de alérgenos "
                "contra el etiquetado y GET /search contra POST "
                "/search/personalized en las consultas con restricción. Se "
                "calcula al reconstruir el índice.",
    responses=respuestas_error(403),
)
def metricas_evaluacion_adaptativa(metricas: Metricas):
    return metricas.evaluacion_adaptativa()
