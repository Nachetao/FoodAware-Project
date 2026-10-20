from fastapi import APIRouter, Depends

from app.core.errores import respuestas_error
from app.core.request_id import marcar_stub
from app.core.simulacion import simular_error
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.services import operacion_stub

router = APIRouter(
    dependencies=[Depends(marcar_stub), Depends(simular_error)]
)


@router.post(
    "/ingest/runs",
    response_model=ResumenIngesta,
    status_code=202,
    tags=["ingesta"],
    summary="Inicia una ejecución de ingesta desde Open Food Facts",
    responses=respuestas_error(422, 503),
)
def iniciar_ingesta(solicitud: SolicitudIngesta):
    return operacion_stub.iniciar_ingesta(solicitud)


@router.get(
    "/ingest/runs/latest",
    response_model=ResumenIngesta,
    tags=["ingesta"],
    summary="Resumen de la última ejecución de ingesta",
    responses=respuestas_error(404),
)
def ultima_ingesta():
    return operacion_stub.ultima_ingesta()


@router.get(
    "/metrics/quality",
    response_model=MetricasCalidad,
    tags=["metricas"],
    summary="Métricas de calidad de los datos almacenados",
    responses=respuestas_error(),
)
def metricas_calidad():
    return operacion_stub.metricas_calidad()


@router.get(
    "/metrics/evaluation",
    response_model=MetricasEvaluacion,
    tags=["metricas"],
    summary="Métricas de evaluación de la búsqueda (Precision@K)",
    responses=respuestas_error(),
)
def metricas_evaluacion():
    return operacion_stub.metricas_evaluacion()
