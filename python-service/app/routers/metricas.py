from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.dependencias import obtener_metricas
from app.core.errores import respuestas_error
from app.core.request_id import marcar_stub
from app.core.simulacion import simular_error
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.services import metricas_stub
from app.services.metricas import ServicioMetricas

router = APIRouter()


@router.get(
    "/metrics/quality",
    response_model=MetricasCalidad,
    tags=["metricas"],
    summary="Métricas de calidad de los datos almacenados",
    responses=respuestas_error(),
    dependencies=[Depends(simular_error)],
)
async def metricas_calidad(
    metricas: Annotated[ServicioMetricas, Depends(obtener_metricas)],
):
    return await metricas.calidad()


@router.get(
    "/metrics/evaluation",
    response_model=MetricasEvaluacion,
    tags=["metricas"],
    summary="Métricas de evaluación de la búsqueda (Precision@K)",
    responses=respuestas_error(),
    # Sigue siendo stub hasta la Parte 3 del Bloque 5. X-Stub se marca
    # antes de simular errores, para que también vaya en esas respuestas.
    dependencies=[Depends(marcar_stub), Depends(simular_error)],
)
def metricas_evaluacion():
    return metricas_stub.metricas_evaluacion()
