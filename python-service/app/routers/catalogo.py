from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.core.dependencias import obtener_catalogo
from app.core.errores import respuestas_error
from app.core.simulacion import simular_error
from app.schemas.busqueda import RespuestaBusqueda
from app.schemas.producto import Producto
from app.services.catalogo import ServicioCatalogo

router = APIRouter(dependencies=[Depends(simular_error)])

Catalogo = Annotated[ServicioCatalogo, Depends(obtener_catalogo)]


@router.get(
    "/products/{codigo_barras}",
    response_model=Producto,
    tags=["productos"],
    summary="Obtiene un producto por código de barras",
    responses=respuestas_error(404, 422, 503, 504),
)
async def obtener_producto(
    codigo_barras: Annotated[
        str,
        Path(pattern=r"^\d{8,14}$", description="De 8 a 14 dígitos."),
    ],
    catalogo: Catalogo,
):
    return await catalogo.obtener_producto(codigo_barras)


@router.get(
    "/search",
    response_model=RespuestaBusqueda,
    tags=["busqueda"],
    summary="Busca productos por texto con ranking de relevancia",
    responses=respuestas_error(422, 503, 504),
)
async def buscar(
    q: Annotated[
        str,
        Query(min_length=2, max_length=100, description="Texto a buscar."),
    ],
    catalogo: Catalogo,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await catalogo.buscar(q, limit, offset)
