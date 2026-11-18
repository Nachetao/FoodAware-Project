from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.core.dependencias import obtener_busqueda, obtener_catalogo
from app.core.clave_servicio import exigir_clave_servicio
from app.core.errores import respuestas_error
from app.core.simulacion import simular_error
from app.schemas.adaptativo import (
    RespuestaBusquedaPersonalizada,
    SolicitudBusquedaPersonalizada,
    SolicitudCompatibilidad,
    Veredicto,
)
from app.services.adaptativo import ServicioAdaptativo
from app.services.busqueda import ServicioBusqueda
from app.services.catalogo import ServicioCatalogo

# La clave va antes de la simulación: sin ella no se puede forzar un
# error simulado.
router = APIRouter(
    dependencies=[Depends(exigir_clave_servicio), Depends(simular_error)]
)


def obtener_adaptativo(
    catalogo: Annotated[ServicioCatalogo, Depends(obtener_catalogo)],
    busqueda: Annotated[ServicioBusqueda, Depends(obtener_busqueda)],
) -> ServicioAdaptativo:
    # Sin estado propio: usa el catálogo y el índice vigentes.
    return ServicioAdaptativo(catalogo, busqueda)


Adaptativo = Annotated[ServicioAdaptativo, Depends(obtener_adaptativo)]


@router.post(
    "/products/{codigo_barras}/compatibility",
    response_model=Veredicto,
    tags=["adaptativo"],
    summary="Veredicto de compatibilidad de un producto con un perfil",
    description="El perfil va en el cuerpo (POST) para que no quede en "
                "URL ni en logs. El producto se obtiene igual que en "
                "GET /products/{codigo_barras}.",
    responses=respuestas_error(403, 404, 422, 503, 504),
)
async def compatibilidad(
    codigo_barras: Annotated[
        str,
        Path(pattern=r"^\d{8,14}$", description="De 8 a 14 dígitos."),
    ],
    solicitud: SolicitudCompatibilidad,
    adaptativo: Adaptativo,
):
    return await adaptativo.compatibilidad(codigo_barras, solicitud.perfil)


@router.post(
    "/search/personalized",
    response_model=RespuestaBusquedaPersonalizada,
    tags=["adaptativo"],
    summary="Búsqueda BM25 personalizada según un perfil",
    description="Ordena aptos, apto_con_advertencia y no_apto (ocultos en "
                "modo filtrar), informa cuántos no_apto hay y por qué, y "
                "compara el top con el ranking base de GET /search.",
    responses=respuestas_error(403, 422),
)
async def buscar_personalizada(
    solicitud: SolicitudBusquedaPersonalizada,
    adaptativo: Adaptativo,
):
    return await adaptativo.buscar_personalizada(solicitud)
