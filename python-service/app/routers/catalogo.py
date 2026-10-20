import time
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.core.errores import NoEncontrado, respuestas_error
from app.core.request_id import marcar_stub
from app.schemas.busqueda import RespuestaBusqueda
from app.schemas.producto import Producto
from app.services import catalogo_stub

router = APIRouter(dependencies=[Depends(marcar_stub)])


@router.get(
    "/products/{codigo_barras}",
    response_model=Producto,
    tags=["productos"],
    summary="Obtiene un producto por código de barras",
    responses=respuestas_error(404, 422, 503, 504),
)
def obtener_producto(
    codigo_barras: Annotated[
        str,
        Path(pattern=r"^\d{8,14}$", description="De 8 a 14 dígitos."),
    ],
):
    producto = catalogo_stub.obtener_producto(codigo_barras)
    if producto is None:
        raise NoEncontrado(f"Producto {codigo_barras} no encontrado")
    return producto


@router.get(
    "/search",
    response_model=RespuestaBusqueda,
    tags=["busqueda"],
    summary="Busca productos por texto con ranking de relevancia",
    responses=respuestas_error(422, 503, 504),
)
def buscar(
    q: Annotated[
        str,
        Query(min_length=2, max_length=100, description="Texto a buscar."),
    ],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    inicio = time.perf_counter()
    total, resultados = catalogo_stub.buscar(q, limit, offset)
    return RespuestaBusqueda(
        consulta=q,
        total=total,
        tiempo_ms=round((time.perf_counter() - inicio) * 1000, 3),
        resultados=resultados,
        estado_fuente="online",
    )
