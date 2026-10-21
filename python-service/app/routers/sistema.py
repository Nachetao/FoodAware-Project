import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.core.dependencias import obtener_busqueda, obtener_repositorio
from app.repositories.cache import RepositorioCache
from app.schemas.sistema import RespuestaSalud
from app.services.busqueda import ServicioBusqueda
from app.services.salud import evaluar_salud

router = APIRouter(tags=["sistema"])


@router.get("/")
def read_root():
    return {"status": "Servicio FastAPI activo"}


@router.get(
    "/health",
    response_model=RespuestaSalud,
    summary="Estado del servicio y de sus dependencias",
    description=(
        "200 con estado `ok` o `degradado` (el servicio responde desde la "
        "caché); 503 con estado `error` si la caché no responde. No consulta "
        "Open Food Facts: su estado sale de la última ingesta y de la última "
        "falla registrada."
    ),
    responses={503: {"model": RespuestaSalud,
                     "description": "La caché no responde (estado error)."}},
)
async def health_check(
    request: Request,
    response: Response,
    repositorio: Annotated[RepositorioCache, Depends(obtener_repositorio)],
    busqueda: Annotated[ServicioBusqueda, Depends(obtener_busqueda)],
):
    salud = await asyncio.to_thread(evaluar_salud, repositorio, busqueda,
                                    request.app.version)
    if salud.estado == "error":
        response.status_code = 503
    return salud
