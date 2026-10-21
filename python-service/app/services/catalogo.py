"""Productos y búsqueda sobre la caché local de Open Food Facts."""
import asyncio
import logging
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Sequence, Tuple

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.errores import (
    FuenteNoDisponible,
    FuenteTimeout,
    NoEncontrado,
)
from app.repositories.cache import RepositorioCache
from app.schemas.busqueda import RespuestaBusqueda, ResultadoBusqueda
from app.schemas.producto import Producto
from app.services.mapeo_off import ProductoInvalido, mapear_producto

logger = logging.getLogger(__name__)

SIN_CLIENTE = "Open Food Facts no está configurado (falta OFF_USER_AGENT)"


class ServicioCatalogo:
    def __init__(
        self,
        repositorio: RepositorioCache,
        cliente: Optional[ClienteOpenFoodFacts],
        base_url: str,
    ) -> None:
        self._repositorio = repositorio
        self._cliente = cliente
        self._base_url = base_url

    async def obtener_producto(self, codigo_barras: str) -> Producto:
        """Busca en la caché; si no está, lo trae de OFF y lo guarda."""
        cacheado = await asyncio.to_thread(
            self._repositorio.obtener_producto, codigo_barras
        )
        if cacheado is not None:
            return cacheado.producto
        return await self._traer_de_la_fuente(codigo_barras)

    async def _traer_de_la_fuente(self, codigo_barras: str) -> Producto:
        if self._cliente is None:
            raise FuenteNoDisponible(SIN_CLIENTE)
        try:
            payload = await self._cliente.obtener_producto(codigo_barras)
        except (FuenteNoDisponible, FuenteTimeout) as exc:
            await asyncio.to_thread(
                self._repositorio.registrar_error_fuente,
                exc.codigo.value, f"{codigo_barras}: {exc.mensaje}",
            )
            raise
        try:
            producto = mapear_producto(
                payload,
                run_id=uuid.uuid4(),
                recuperado_en=datetime.now(timezone.utc),
                base_url=self._base_url,
            )
        except ProductoInvalido as exc:
            logger.warning("Producto %s descartado: %s", codigo_barras, exc)
            raise NoEncontrado(
                f"El producto {codigo_barras} no tiene datos utilizables"
            ) from None
        await asyncio.to_thread(
            self._repositorio.guardar_producto, producto, payload
        )
        return producto

    async def buscar(
        self, consulta: str, limit: int, offset: int
    ) -> RespuestaBusqueda:
        """Nunca consulta OFF en vivo: busca solo en la caché local."""
        inicio = time.perf_counter()
        productos, ultima = await asyncio.gather(
            asyncio.to_thread(self._repositorio.listar_productos),
            asyncio.to_thread(self._repositorio.ultima_ejecucion_terminada),
        )
        validos = [p for p in productos if p.calidad.es_valido]
        total, resultados = rankear(validos, consulta, limit, offset)
        terminada_bien = ultima is not None and ultima.estado != "fallido"
        return RespuestaBusqueda(
            consulta=consulta,
            total=total,
            tiempo_ms=round((time.perf_counter() - inicio) * 1000, 3),
            resultados=resultados,
            estado_fuente="online" if terminada_bien else "cache",
        )


def tokens(texto: str) -> List[str]:
    """Minúsculas, sin tildes y separado por caracteres no alfanuméricos."""
    sin_tildes = unicodedata.normalize("NFKD", texto.lower())
    sin_tildes = "".join(c for c in sin_tildes if not unicodedata.combining(c))
    return "".join(c if c.isalnum() else " " for c in sin_tildes).split()


def rankear(
    productos: Sequence[Producto], consulta: str, limit: int, offset: int
) -> Tuple[int, List[ResultadoBusqueda]]:
    """Ranking simple: cantidad de términos de la consulta presentes.

    Se reemplazará por BM25 en el Bloque 4.
    """
    terminos = set(tokens(consulta))
    puntuados = []
    for producto in productos:
        texto = " ".join(
            [producto.nombre, producto.marca or "", *producto.ingredientes]
        )
        score = float(len(terminos & set(tokens(texto))))
        if score > 0:
            puntuados.append((score, producto))
    puntuados.sort(key=lambda par: (-par[0], par[1].nombre))
    pagina = puntuados[offset:offset + limit]
    resultados = [
        ResultadoBusqueda(producto=p, score=s, posicion=offset + i + 1)
        for i, (s, p) in enumerate(pagina)
    ]
    return len(puntuados), resultados
