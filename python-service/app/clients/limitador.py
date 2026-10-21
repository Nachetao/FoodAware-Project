import asyncio
import time
from collections import deque
from typing import Awaitable, Callable, Deque


class LimitadorTasa:
    """Ventana deslizante: como máximo `max_llamadas` por `periodo`.

    `reloj` y `dormir` se inyectan para poder probarlo sin esperar.
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
        self._marcas: Deque[float] = deque()
        self._candado = asyncio.Lock()

    async def esperar_turno(self) -> None:
        # El candado serializa la espera: las llamadas salen en orden.
        async with self._candado:
            while True:
                ahora = self._reloj()
                while self._marcas and ahora - self._marcas[0] >= self.periodo:
                    self._marcas.popleft()
                if len(self._marcas) < self.max_llamadas:
                    self._marcas.append(ahora)
                    return
                await self._dormir(self.periodo - (ahora - self._marcas[0]))
