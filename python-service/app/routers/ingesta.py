import asyncio
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends

from app.core.clave_ingesta import exigir_clave_ingesta
from app.core.dependencias import obtener_ingesta, obtener_repositorio
from app.core.errores import NoEncontrado, respuestas_error
from app.core.simulacion import simular_error
from app.repositories.cache import RepositorioCache
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.ingesta import ServicioIngesta

router = APIRouter(dependencies=[Depends(simular_error)])


@router.post(
    "/ingest/runs",
    response_model=ResumenIngesta,
    status_code=202,
    tags=["ingesta"],
    summary="Inicia una ejecución de ingesta desde Open Food Facts",
    description="Requiere el header X-Clave-Ingesta con la clave interna; "
                "sin ella responde 403 antes de validar el cuerpo.",
    responses=respuestas_error(403, 422, 503),
    dependencies=[Depends(exigir_clave_ingesta)],
)
async def iniciar_ingesta(
    solicitud: SolicitudIngesta,
    tareas: BackgroundTasks,
    ingesta: Annotated[ServicioIngesta, Depends(obtener_ingesta)],
):
    resumen, es_nueva = await ingesta.iniciar(solicitud)
    if es_nueva:
        # Se procesa después de enviar el 202.
        tareas.add_task(ingesta.ejecutar, resumen, solicitud)
    return resumen


@router.get(
    "/ingest/runs/latest",
    response_model=ResumenIngesta,
    tags=["ingesta"],
    summary="Resumen de la última ejecución de ingesta",
    responses=respuestas_error(404),
)
async def ultima_ingesta(
    repositorio: Annotated[RepositorioCache, Depends(obtener_repositorio)],
):
    resumen = await asyncio.to_thread(repositorio.ultima_ejecucion)
    if resumen is None:
        raise NoEncontrado("Todavía no hay ejecuciones de ingesta")
    return resumen
