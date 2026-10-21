from fastapi import APIRouter, Depends

from app.core.errores import respuestas_error
from app.core.request_id import marcar_stub
from app.core.simulacion import simular_error
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.services import metricas_stub

# Siguen siendo stub hasta el Bloque 5.
router = APIRouter(
    dependencies=[Depends(marcar_stub), Depends(simular_error)]
)


@router.get(
    "/metrics/quality",
    response_model=MetricasCalidad,
    tags=["metricas"],
    summary="Métricas de calidad de los datos almacenados",
    responses=respuestas_error(),
)
def metricas_calidad():
    return metricas_stub.metricas_calidad()


@router.get(
    "/metrics/evaluation",
    response_model=MetricasEvaluacion,
    tags=["metricas"],
    summary="Métricas de evaluación de la búsqueda (Precision@K)",
    responses=respuestas_error(),
)
def metricas_evaluacion():
    return metricas_stub.metricas_evaluacion()
