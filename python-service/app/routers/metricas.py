from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.dependencias import obtener_metricas
from app.core.errores import respuestas_error
from app.core.simulacion import simular_error
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.services.metricas import ServicioMetricas

router = APIRouter(dependencies=[Depends(simular_error)])

Metricas = Annotated[ServicioMetricas, Depends(obtener_metricas)]


@router.get(
    "/metrics/quality",
    response_model=MetricasCalidad,
    tags=["metricas"],
    summary="Métricas de calidad de los datos almacenados",
    responses=respuestas_error(),
)
async def metricas_calidad(metricas: Metricas):
    return await metricas.calidad()


@router.get(
    "/metrics/evaluation",
    response_model=MetricasEvaluacion,
    tags=["metricas"],
    summary="Métricas de evaluación de la búsqueda (Precision@K y "
    "Recall@K)",
    responses=respuestas_error(),
)
def metricas_evaluacion(metricas: Metricas):
    return metricas.evaluacion()
