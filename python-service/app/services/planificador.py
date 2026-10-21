"""Estrategia de actualización de la caché: ingesta inicial y periódica."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from app.core.errores import ErrorAPI
from app.repositories.cache import RepositorioCache
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.ingesta import ServicioIngesta

logger = logging.getLogger(__name__)

# Pausa tras un error inesperado, para no reintentar en un bucle cerrado.
PAUSA_TRAS_ERROR_SEGUNDOS = 300.0


class PlanificadorIngesta:
    def __init__(
        self,
        servicio: ServicioIngesta,
        repositorio: RepositorioCache,
        *,
        intervalo: timedelta,
        al_iniciar: bool,
        solicitud: Optional[SolicitudIngesta] = None,
        reloj: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        dormir: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._servicio = servicio
        self._repositorio = repositorio
        self._intervalo = intervalo
        self._al_iniciar = al_iniciar
        self._solicitud = solicitud or SolicitudIngesta()
        self._reloj = reloj
        self._dormir = dormir

    async def bucle(self, iteraciones: Optional[int] = None) -> None:
        """Ingesta inicial si corresponde y luego refresco periódico.

        `iteraciones` limita las vueltas (solo para tests).
        """
        try:
            await self.al_arrancar()
        except Exception:
            logger.exception("Falló la ingesta inicial")
        vueltas = 0
        while iteraciones is None or vueltas < iteraciones:
            vueltas += 1
            try:
                espera = await self.segundos_hasta_la_proxima()
                logger.info("Próxima ingesta periódica en %.0f s", espera)
                await self._dormir(espera)
                await self._lanzar("refresco periódico")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error en el planificador de ingestas")
                await self._dormir(PAUSA_TRAS_ERROR_SEGUNDOS)

    async def al_arrancar(self) -> Optional[ResumenIngesta]:
        if not self._al_iniciar:
            return None
        total = await asyncio.to_thread(self._repositorio.contar_productos)
        if total > 0:
            return None
        return await self._lanzar("la caché está vacía")

    async def segundos_hasta_la_proxima(self) -> float:
        """Intervalo desde el inicio de la última ejecución registrada.

        Así un reinicio del servicio no pospone el refresco.
        """
        ultima = await asyncio.to_thread(self._repositorio.ultima_ejecucion)
        if ultima is None:
            return self._intervalo.total_seconds()
        proxima = ultima.inicio + self._intervalo
        return max(0.0, (proxima - self._reloj()).total_seconds())

    async def _lanzar(self, motivo: str) -> Optional[ResumenIngesta]:
        try:
            resumen, es_nueva = await self._servicio.iniciar(self._solicitud)
        except ErrorAPI as exc:
            logger.error("No se pudo iniciar la ingesta (%s): %s", motivo,
                         exc.mensaje)
            return None
        if not es_nueva:
            logger.info("Ya hay una ingesta en curso; se omite el %s", motivo)
            return None
        logger.info("Ingesta %s lanzada: %s", resumen.run_id, motivo,
                    extra={"run_id": str(resumen.run_id)})
        return await self._servicio.ejecutar(resumen, self._solicitud)
