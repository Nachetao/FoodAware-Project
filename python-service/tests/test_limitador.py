import asyncio

import pytest

from app.clients.limitador import LimiteTasaExcedido, LimitadorTasa

pytestmark = pytest.mark.anyio


class RelojFalso:
    """Reloj manual: dormir solo registra la espera, no avanza el tiempo."""

    def __init__(self):
        self.ahora = 0.0
        self.esperas = []

    def __call__(self):
        return self.ahora

    async def dormir(self, segundos):
        self.esperas.append(segundos)
        await asyncio.sleep(0)


def crear(max_llamadas, reloj):
    return LimitadorTasa(max_llamadas, 60, reloj=reloj, dormir=reloj.dormir)


async def test_permite_hasta_el_maximo_sin_esperar():
    reloj = RelojFalso()
    limitador = crear(3, reloj)
    for _ in range(3):
        await limitador.esperar_turno()
    assert reloj.esperas == []


async def test_espera_hasta_que_se_libera_la_ventana():
    reloj = RelojFalso()
    limitador = crear(2, reloj)
    await limitador.esperar_turno()
    reloj.ahora = 30
    await limitador.esperar_turno()
    await limitador.esperar_turno()
    # El turno de t=0 sale de la ventana en t=60.
    assert reloj.esperas == [30]


async def test_la_ventana_se_desliza():
    reloj = RelojFalso()
    limitador = crear(2, reloj)
    await limitador.esperar_turno()
    await limitador.esperar_turno()
    reloj.ahora = 60
    await limitador.esperar_turno()
    assert reloj.esperas == []


async def test_llamadas_concurrentes_reservan_turnos_sucesivos():
    reloj = RelojFalso()
    limitador = crear(2, reloj)
    await asyncio.gather(*(limitador.esperar_turno() for _ in range(5)))
    # Nunca más de 2 turnos dentro de cada ventana de 60 s.
    assert sorted(reloj.esperas) == [60, 60, 120]


async def test_espera_maxima_falla_sin_consumir_turno():
    reloj = RelojFalso()
    limitador = crear(1, reloj)
    await limitador.esperar_turno()
    reloj.ahora = 50
    with pytest.raises(LimiteTasaExcedido) as error:
        await limitador.esperar_turno(espera_maxima=3)
    assert error.value.espera_necesaria == 10
    assert reloj.esperas == []
    # Al no consumir turno, quien sí puede esperar recibe el turno de t=60.
    await limitador.esperar_turno()
    assert reloj.esperas == [10]


async def test_espera_dentro_del_maximo_se_respeta():
    reloj = RelojFalso()
    limitador = crear(1, reloj)
    await limitador.esperar_turno()
    reloj.ahora = 58
    await limitador.esperar_turno(espera_maxima=3)
    assert reloj.esperas == [2]


async def test_espera_maxima_no_se_alarga_por_la_fila():
    reloj = RelojFalso()
    limitador = crear(1, reloj)
    await limitador.esperar_turno()
    reloj.ahora = 57
    # La ingesta reserva el turno de t=60 y espera sin tope...
    await limitador.esperar_turno()
    # ...y la petición siguiente necesitaría 63 s: falla de inmediato.
    with pytest.raises(LimiteTasaExcedido):
        await limitador.esperar_turno(espera_maxima=3)


def test_max_llamadas_invalido():
    with pytest.raises(ValueError):
        LimitadorTasa(0)
