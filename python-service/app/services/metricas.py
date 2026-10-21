"""GET /metrics/quality y GET /metrics/evaluation.

Las definiciones están en app.metricas.calidad y app.metricas.evaluacion.
"""
import asyncio
from datetime import datetime, timezone
from typing import Callable

from app.metricas.calidad import calcular_metricas_calidad
from app.metricas.evaluacion import metricas_evaluacion
from app.repositories.cache import RepositorioCache
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.services.busqueda import ServicioBusqueda


class ServicioMetricas:
    def __init__(
        self,
        repositorio: RepositorioCache,
        busqueda: ServicioBusqueda,
        reloj: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._repositorio = repositorio
        self._busqueda = busqueda
        self._reloj = reloj

    def calidad_ahora(self) -> MetricasCalidad:
        return calcular_metricas_calidad(
            self._repositorio.listar_ejecuciones_terminadas(),
            self._repositorio.estado_productos(),
            self._reloj(),
        )

    async def calidad(self) -> MetricasCalidad:
        return await asyncio.to_thread(self.calidad_ahora)

    def evaluacion(self) -> MetricasEvaluacion:
        """La evaluación ya calculada al reconstruir el índice."""
        return metricas_evaluacion(self._busqueda.evaluacion)
