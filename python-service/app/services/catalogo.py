"""Productos y búsqueda sobre la caché local de Open Food Facts."""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional, Sequence, Tuple

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.errores import (
    FuenteNoDisponible,
    FuenteTimeout,
    NoEncontrado,
)
from app.procesamiento.texto import tokenizar
from app.repositories.cache import (
    ProductoCacheado,
    RepositorioCache,
)
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
        *,
        espera_maxima: Optional[float] = None,
        ttl: timedelta = timedelta(hours=72),
        reloj: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._repositorio = repositorio
        self._cliente = cliente
        self._base_url = base_url
        self._espera_maxima = espera_maxima
        self._ttl = ttl
        self._reloj = reloj

    async def obtener_producto(self, codigo_barras: str) -> Producto:
        """Busca en la caché; si no está, lo trae de OFF y lo guarda.

        Si el de la caché superó el TTL y OFF está disponible, se refresca;
        si no se puede refrescar, se devuelve el de la caché.
        """
        cacheado = await asyncio.to_thread(
            self._repositorio.obtener_producto, codigo_barras
        )
        if cacheado is None:
            return await self._traer_de_la_fuente(codigo_barras)
        if self._cliente is None or not self._vencido(cacheado):
            return cacheado.producto
        try:
            return await self._traer_de_la_fuente(codigo_barras)
        except (FuenteNoDisponible, FuenteTimeout, NoEncontrado) as exc:
            logger.warning("No se pudo refrescar el producto %s (%s); se "
                           "devuelve el de la caché", codigo_barras,
                           exc.mensaje)
            return cacheado.producto

    def _vencido(self, cacheado: ProductoCacheado) -> bool:
        return self._reloj() - cacheado.verificado_en > self._ttl

    async def _traer_de_la_fuente(self, codigo_barras: str) -> Producto:
        if self._cliente is None:
            raise FuenteNoDisponible(SIN_CLIENTE)
        try:
            payload = await self._cliente.obtener_producto(
                codigo_barras, espera_maxima=self._espera_maxima
            )
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
        # Se relee: si no hubo cambios, la caché conserva su procedencia
        # original, y así vienen marcados los posibles duplicados.
        guardado = await asyncio.to_thread(
            self._repositorio.obtener_producto, producto.codigo_barras
        )
        return guardado.producto

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


def rankear(
    productos: Sequence[Producto], consulta: str, limit: int, offset: int
) -> Tuple[int, List[ResultadoBusqueda]]:
    """Ranking simple: cantidad de términos de la consulta presentes.

    Se reemplazará por BM25 en el Bloque 4.
    """
    terminos = set(tokenizar(consulta))
    puntuados = []
    for producto in productos:
        texto = " ".join(
            [producto.nombre, producto.marca or "", *producto.ingredientes]
        )
        score = float(len(terminos & set(tokenizar(texto))))
        if score > 0:
            puntuados.append((score, producto))
    puntuados.sort(key=lambda par: (-par[0], par[1].nombre))
    pagina = puntuados[offset:offset + limit]
    resultados = [
        ResultadoBusqueda(producto=p, score=s, posicion=offset + i + 1)
        for i, (s, p) in enumerate(pagina)
    ]
    return len(puntuados), resultados
