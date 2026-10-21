"""GET /search: búsqueda BM25 sobre un índice en memoria.

El índice se construye desde la caché al iniciar el servicio y se
reconstruye al terminar cada ingesta. Nunca consulta Open Food Facts en
vivo.

Reemplazo seguro: la reconstrucción arma una Instantanea nueva completa
(en un hilo aparte) y recién al final reemplaza la referencia, que en
Python es una asignación atómica. Cada búsqueda lee la referencia una vez
al empezar, así que termina con el índice que tomó aunque se reemplace a
mitad de camino; nunca ve uno a medio construir. Un candado evita que dos
reconstrucciones se pisen.
"""
import asyncio
import logging
import threading
import time
from typing import Mapping, Optional

from app.busqueda.bm25 import ParametrosBM25
from app.busqueda.buscador import Instantanea
from app.repositories.cache import RepositorioCache
from app.schemas.busqueda import RespuestaBusqueda

logger = logging.getLogger(__name__)


class ServicioBusqueda:
    def __init__(
        self,
        repositorio: RepositorioCache,
        *,
        pesos: Optional[Mapping[str, float]] = None,
        parametros: ParametrosBM25 = ParametrosBM25(),
    ) -> None:
        self._repositorio = repositorio
        self._pesos = pesos
        self._parametros = parametros
        self._instantanea = Instantanea.vacia()
        self._candado = threading.Lock()

    @property
    def instantanea(self) -> Instantanea:
        return self._instantanea

    def reconstruir_ahora(self) -> Instantanea:
        """Construye el índice desde la caché y lo publica (síncrono)."""
        with self._candado:
            inicio = time.perf_counter()
            registros = self._repositorio.listar_productos_con_payload()
            nueva = Instantanea.construir(
                registros, pesos=self._pesos, parametros=self._parametros
            )
            self._instantanea = nueva  # el reemplazo atómico
        logger.info(
            "Índice de búsqueda: %d productos, %d términos (%.0f ms)",
            nueva.indice.n_documentos, nueva.indice.terminos_distintos(),
            (time.perf_counter() - inicio) * 1000,
        )
        return nueva

    async def reconstruir(self) -> Instantanea:
        return await asyncio.to_thread(self.reconstruir_ahora)

    async def buscar(
        self, consulta: str, limit: int, offset: int
    ) -> RespuestaBusqueda:
        inicio = time.perf_counter()
        instantanea = self._instantanea  # se lee una sola vez
        total, resultados = instantanea.buscar(consulta, limit, offset)
        ultima = await asyncio.to_thread(
            self._repositorio.ultima_ejecucion_terminada
        )
        terminada_bien = ultima is not None and ultima.estado != "fallido"
        return RespuestaBusqueda(
            consulta=consulta,
            total=total,
            tiempo_ms=round((time.perf_counter() - inicio) * 1000, 3),
            resultados=resultados,
            estado_fuente="online" if terminada_bien else "cache",
        )
