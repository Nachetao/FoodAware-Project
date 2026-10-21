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

Cada reconstrucción también evalúa el índice nuevo con el conjunto de
evaluación (Precision@K y Recall@K) antes de publicarlo, y publica ambos
juntos: GET /metrics/evaluation lee ese resultado sin evaluar en cada
petición, y siempre corresponde al índice que está respondiendo /search.
"""
import asyncio
import logging
import threading
import time
from typing import Mapping, Optional, Tuple

from app.busqueda.bm25 import ParametrosBM25
from app.busqueda.buscador import Instantanea
from app.evaluacion.conjunto import ConjuntoEvaluacion, cargar_conjunto
from app.evaluacion.evaluador import (
    K_POR_DEFECTO,
    ResultadoEvaluacion,
    evaluar_instantanea,
)
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
        conjunto: Optional[ConjuntoEvaluacion] = None,
        k_evaluacion: int = K_POR_DEFECTO,
    ) -> None:
        self._repositorio = repositorio
        self._pesos = pesos
        self._parametros = parametros
        self._conjunto = conjunto or cargar_conjunto()
        self._k = k_evaluacion
        vacia = Instantanea.vacia()
        # Índice y su evaluación se publican juntos en una sola asignación.
        self._publicado: Tuple[Instantanea, ResultadoEvaluacion] = (
            vacia, evaluar_instantanea(self._conjunto, [], vacia, self._k)
        )
        self._candado = threading.Lock()
        # False hasta la primera reconstrucción desde la caché.
        self._cargado = False

    @property
    def instantanea(self) -> Instantanea:
        return self._publicado[0]

    @property
    def cargado(self) -> bool:
        return self._cargado

    @property
    def evaluacion(self) -> ResultadoEvaluacion:
        """Evaluación del índice publicado (no se recalcula al leerla)."""
        return self._publicado[1]

    def reconstruir_ahora(self) -> Instantanea:
        """Construye el índice desde la caché, lo evalúa y publica ambos
        (síncrono)."""
        with self._candado:
            inicio = time.perf_counter()
            registros = self._repositorio.listar_productos_con_payload()
            nueva = Instantanea.construir(
                registros, pesos=self._pesos, parametros=self._parametros
            )
            evaluacion = evaluar_instantanea(self._conjunto, registros,
                                             nueva, self._k)
            self._publicado = (nueva, evaluacion)  # el reemplazo atómico
            self._cargado = True
        promedio = evaluacion.promedio()
        logger.info(
            "Índice de búsqueda: %d productos, %d términos (%.0f ms); "
            "P@%d %.2f y R@%d %.2f en %d consultas",
            nueva.indice.n_documentos, nueva.indice.terminos_distintos(),
            (time.perf_counter() - inicio) * 1000, self._k,
            promedio.precision, self._k, promedio.recall,
            promedio.consultas,
        )
        return nueva

    async def reconstruir(self) -> Instantanea:
        return await asyncio.to_thread(self.reconstruir_ahora)

    async def buscar(
        self, consulta: str, limit: int, offset: int
    ) -> RespuestaBusqueda:
        inicio = time.perf_counter()
        instantanea = self.instantanea  # se lee una sola vez
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
