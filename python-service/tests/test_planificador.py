import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main
from app.core import config
from app.core.errores import FuenteNoDisponible
from app.repositories.cache import RepositorioCache
from app.schemas.ingesta import ResumenIngesta
from app.services.ingesta import ServicioIngesta
from app.services.mapeo_off import mapear_producto
from app.services.planificador import (
    PAUSA_TRAS_ERROR_SEGUNDOS,
    PlanificadorIngesta,
)
from tests.payloads_off import GALLETAS, LECHE

pytestmark = [pytest.mark.anyio, pytest.mark.recuperacion]

AHORA = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)
INTERVALO = timedelta(hours=24)


@pytest.fixture
def repo(tmp_path):
    repositorio = RepositorioCache(str(tmp_path / "cache.sqlite3"))
    repositorio.inicializar()
    return repositorio


@pytest.fixture
def esperas():
    return []


def crear(repo, off_falso, esperas, al_iniciar=True, cliente="falso"):
    async def dormir(segundos):
        esperas.append(segundos)

    servicio = ServicioIngesta(
        repo, off_falso if cliente == "falso" else None, "https://x",
        pausa_reintento=0,
    )
    return PlanificadorIngesta(
        servicio, repo, intervalo=INTERVALO, al_iniciar=al_iniciar,
        reloj=lambda: AHORA, dormir=dormir,
    )


def registrar(repo, inicio):
    repo.guardar_ejecucion(ResumenIngesta(
        run_id=uuid.uuid4(), inicio=inicio, fin=inicio, recuperados=0,
        validos=0, invalidos=0, duplicados=0, errores=0, estado="completado",
    ))


async def test_ingesta_inicial_si_la_cache_esta_vacia(repo, off_falso,
                                                      esperas):
    off_falso.paginas = [{"products": [LECHE, GALLETAS]}]
    resumen = await crear(repo, off_falso, esperas).al_arrancar()
    assert resumen.estado == "completado"
    assert repo.contar_productos() == 2


async def test_no_ingesta_inicial_si_hay_productos(repo, off_falso, esperas):
    producto = mapear_producto(LECHE, run_id=uuid.uuid4(), recuperado_en=AHORA,
                               base_url="https://x")
    repo.guardar_producto(producto, LECHE)
    assert await crear(repo, off_falso, esperas).al_arrancar() is None
    assert off_falso.llamadas == []


async def test_ingesta_inicial_desactivada(repo, off_falso, esperas):
    planificador = crear(repo, off_falso, esperas, al_iniciar=False)
    assert await planificador.al_arrancar() is None
    assert off_falso.llamadas == []


@pytest.mark.parametrize(
    "inicio_ultima, esperado",
    [(None, 24 * 3600), (AHORA - timedelta(hours=20), 4 * 3600),
     (AHORA - timedelta(hours=30), 0)],
)
async def test_proxima_ingesta_segun_la_ultima(repo, off_falso, esperas,
                                               inicio_ultima, esperado):
    if inicio_ultima:
        registrar(repo, inicio_ultima)
    planificador = crear(repo, off_falso, esperas)
    assert await planificador.segundos_hasta_la_proxima() == esperado


async def test_bucle_espera_y_refresca(repo, off_falso, esperas):
    registrar(repo, AHORA - timedelta(hours=20))
    producto = mapear_producto(LECHE, run_id=uuid.uuid4(), recuperado_en=AHORA,
                               base_url="https://x")
    repo.guardar_producto(producto, LECHE)
    off_falso.paginas = [{"products": [GALLETAS]}]
    await crear(repo, off_falso, esperas).bucle(iteraciones=1)
    assert esperas == [4 * 3600]
    assert repo.ultima_ejecucion().estado == "completado"
    assert repo.contar_productos() == 2


async def test_bucle_sigue_tras_un_error(repo, off_falso, esperas,
                                         monkeypatch):
    planificador = crear(repo, off_falso, esperas, al_iniciar=False)

    async def falla():
        raise RuntimeError("base no disponible")

    monkeypatch.setattr(planificador, "segundos_hasta_la_proxima", falla)
    await planificador.bucle(iteraciones=2)
    assert esperas == [PAUSA_TRAS_ERROR_SEGUNDOS, PAUSA_TRAS_ERROR_SEGUNDOS]


async def test_fuente_caida_no_rompe_el_planificador(repo, off_falso,
                                                     esperas):
    off_falso.paginas = [FuenteNoDisponible("HTTP 503")]
    await crear(repo, off_falso, esperas).bucle(iteraciones=1)
    assert repo.ultima_ejecucion().estado == "fallido"


async def test_sin_cliente_no_lanza_ingestas(repo, off_falso, esperas):
    planificador = crear(repo, off_falso, esperas, cliente=None)
    assert await planificador.al_arrancar() is None


def test_el_arranque_lanza_la_ingesta_inicial(tmp_path, monkeypatch,
                                              off_falso):
    off_falso.paginas = [{"products": [LECHE]}]
    monkeypatch.setattr(config.settings, "cache_db_path",
                        str(tmp_path / "cache.sqlite3"))
    monkeypatch.setattr(main.ClienteOpenFoodFacts, "desde_settings",
                        classmethod(lambda cls, _s: off_falso))
    with TestClient(main.app):
        repo = main.app.state.repositorio
        limite = time.monotonic() + 5
        while time.monotonic() < limite:
            ultima = repo.ultima_ejecucion()
            if ultima and ultima.estado != "en_curso":
                break
            time.sleep(0.05)
    assert ultima.estado == "completado"
    assert repo.contar_productos() == 1
