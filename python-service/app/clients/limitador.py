import asyncio
import time
from collections import deque
from typing import Awaitable, Callable, Deque, Optional


class LimiteTasaExcedido(Exception):
    """El próximo turno libre está más lejos que la espera permitida."""

    def __init__(self, espera_necesaria: float) -> None:
        super().__init__(f"Se necesitarían {espera_necesaria:.1f} s de espera")
        self.espera_necesaria = espera_necesaria


class LimitadorTasa:
    """Ventana deslizante: como máximo `max_llamadas` por `periodo`.

    Cada llamada reserva su turno (ahora o en el futuro) bajo el candado y
    luego duerme fuera de él, así una espera acotada no se alarga por las
    llamadas que hacen fila delante. `reloj` y `dormir` se inyectan para
    poder probarlo sin esperar.
    """

    def __init__(
        self,
        max_llamadas: int,
        periodo_segundos: float = 60.0,
        reloj: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if max_llamadas < 1:
            raise ValueError("max_llamadas debe ser al menos 1")
        self.max_llamadas = max_llamadas
        self.periodo = periodo_segundos
        self._reloj = reloj
        self._dormir = dormir
        # Turnos asignados (pasados o reservados), en orden creciente.
        self._turnos: Deque[float] = deque()
        self._candado = asyncio.Lock()

    async def esperar_turno(
        self, espera_maxima: Optional[float] = None
    ) -> None:
        """Espera hasta tener turno.

        Con `espera_maxima`, si habría que esperar más, lanza
        LimiteTasaExcedido de inmediato y no consume turno.
        """
        async with self._candado:
            ahora = self._reloj()
            while self._turnos and ahora - self._turnos[0] >= self.periodo:
                self._turnos.popleft()
            if len(self._turnos) < self.max_llamadas:
                turno = ahora
            else:
                # Se libera cuando el turno que quedaría fuera sale de la
                # ventana.
                turno = self._turnos[-self.max_llamadas] + self.periodo
            espera = turno - ahora
            if espera_maxima is not None and espera > espera_maxima:
                raise LimiteTasaExcedido(espera)
            self._turnos.append(turno)
        if espera > 0:
            await self._dormir(espera)
