"""GET /metrics/quality: métricas calculadas desde la caché local.

Las definiciones están en app.metricas.calidad.
"""
import asyncio
from datetime import datetime, timezone
from typing import Callable

from app.metricas.calidad import calcular_metricas_calidad
from app.repositories.cache import RepositorioCache
from app.schemas.metricas import MetricasCalidad


class ServicioMetricas:
    def __init__(
        self,
        repositorio: RepositorioCache,
        reloj: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._repositorio = repositorio
        self._reloj = reloj

    def calidad_ahora(self) -> MetricasCalidad:
        return calcular_metricas_calidad(
            self._repositorio.listar_ejecuciones_terminadas(),
            self._repositorio.estado_productos(),
            self._reloj(),
        )

    async def calidad(self) -> MetricasCalidad:
        return await asyncio.to_thread(self.calidad_ahora)
