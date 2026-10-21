import asyncio

import pytest

from app.clients.limitador import LimitadorTasa

pytestmark = pytest.mark.anyio


class RelojFalso:
    def __init__(self):
        self.ahora = 0.0
        self.esperas = []

    def __call__(self):
        return self.ahora

    async def dormir(self, segundos):
        self.esperas.append(segundos)
        self.ahora += segundos
        await asyncio.sleep(0)


def crear(max_llamadas, reloj):
    return LimitadorTasa(max_llamadas, 60, reloj=reloj, dormir=reloj.dormir)


async def test_permite_hasta_el_maximo_sin_esperar():
    reloj = RelojFalso()
    limitador = crear(3, reloj)
    for _ in range(3):
        await limitador.esperar_turno()
    assert reloj.esperas == []


async def test_espera_cuando_se_excede_el_maximo():
    reloj = RelojFalso()
    limitador = crear(2, reloj)
    await limitador.esperar_turno()
    reloj.ahora = 30
    await limitador.esperar_turno()
    await limitador.esperar_turno()
    # La primera llamada (t=0) sale de la ventana en t=60.
    assert reloj.esperas == [30]
    assert reloj.ahora == 60


async def test_llamadas_concurrentes_respetan_el_limite():
    reloj = RelojFalso()
    limitador = crear(2, reloj)
    inicios = []

    async def llamar():
        await limitador.esperar_turno()
        inicios.append(reloj.ahora)

    await asyncio.gather(*(llamar() for _ in range(5)))
    assert inicios == [0, 0, 60, 60, 120]


def test_max_llamadas_invalido():
    with pytest.raises(ValueError):
        LimitadorTasa(0)
