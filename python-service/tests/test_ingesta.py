import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.core.errores import FuenteNoDisponible, FuenteTimeout
from app.main import app
from app.repositories.cache import RepositorioCache
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.ingesta import ServicioIngesta
from tests.payloads_off import GALLETAS, INCOMPLETO, LECHE

pytestmark = pytest.mark.recuperacion


def pagina(*productos):
    return {"count": 99, "products": list(productos)}


def ingestar(client, **cuerpo):
    """POST /ingest/runs; TestClient espera a que termine la tarea."""
    response = client.post("/ingest/runs", json=cuerpo)
    assert response.status_code == 202
    creada = ResumenIngesta.model_validate(response.json())
    assert creada.estado == "en_curso" and creada.fin is None
    final = client.get("/ingest/runs/latest")
    assert final.status_code == 200
    return creada, ResumenIngesta.model_validate(final.json())


def test_ingesta_completa(client, off_falso, repositorio):
    off_falso.paginas = [pagina(LECHE, GALLETAS), pagina(INCOMPLETO)]
    creada, final = ingestar(client, pais="chile", categorias=["en:dairies"])
    assert final.run_id == creada.run_id
    assert final.estado == "completado"
    assert (final.recuperados, final.validos, final.invalidos,
            final.duplicados, final.errores) == (3, 2, 1, 0, 0)
    assert final.fin is not None and final.duracion_ms >= 0
    # Recorre páginas con tamaño fijo y se detiene en la última incompleta.
    assert off_falso.llamadas == [
        ("busqueda", "chile", ("en:dairies",), 1, 2),
        ("busqueda", "chile", ("en:dairies",), 2, 2),
    ]
    # Solo se guardan los válidos, trazables a la ejecución.
    assert repositorio.contar_productos() == 2
    guardado = repositorio.obtener_producto(LECHE["code"]).producto
    assert guardado.procedencia.run_id == creada.run_id


def test_reingesta_cuenta_duplicados(client, off_falso):
    off_falso.paginas = [pagina(LECHE, GALLETAS)]
    ingestar(client)
    _, final = ingestar(client)
    assert (final.validos, final.duplicados) == (2, 2)


def test_respeta_max_productos(client, off_falso, repositorio):
    off_falso.paginas = [pagina(LECHE, GALLETAS), pagina(INCOMPLETO, LECHE)]
    _, final = ingestar(client, max_productos=3)
    assert final.recuperados == 3
    assert len(off_falso.llamadas) == 2


def test_tamano_de_pagina_no_supera_max_productos(client, off_falso):
    off_falso.paginas = [pagina(LECHE)]
    ingestar(client, max_productos=1)
    assert off_falso.llamadas[0][-1] == 1


def test_codigo_invalido_cuenta_como_invalido(client, off_falso):
    off_falso.paginas = [pagina({"code": "12"}, LECHE)]
    _, final = ingestar(client)
    assert (final.recuperados, final.validos, final.invalidos) == (2, 1, 1)


@pytest.mark.parametrize(
    "error, tipo",
    [(FuenteNoDisponible("HTTP 503"), "SOURCE_UNAVAILABLE"),
     (FuenteTimeout("lento"), "SOURCE_TIMEOUT")],
)
def test_caida_a_mitad_de_la_ingesta(client, off_falso, repositorio, error,
                                     tipo):
    off_falso.paginas = [pagina(LECHE, GALLETAS), error]
    creada, final = ingestar(client)
    assert final.estado == "completado_con_errores"
    # La página 2 falló también en el reintento: una página perdida.
    assert (final.recuperados, final.errores) == (2, 1)
    assert off_falso.pausas == [60.0]
    # Las dos fallas quedan registradas (la más reciente primero).
    errores = repositorio.listar_errores_fuente(creada.run_id)
    assert [(e.tipo, e.run_id) for e in errores] == [(tipo, creada.run_id)] * 2
    assert errores[0].mensaje.startswith("reintento, página 2:")
    assert errores[1].mensaje.startswith("página 2:")


def test_caida_en_la_primera_pagina_es_fallida(client, off_falso):
    off_falso.paginas = [FuenteNoDisponible("HTTP 503")]
    _, final = ingestar(client)
    assert final.estado == "fallido"
    assert (final.recuperados, final.errores) == (0, 1)


def test_ultima_ingesta_sin_ejecuciones(client):
    response = client.get("/ingest/runs/latest")
    assert response.status_code == 404
    assert response.json()["error"]["codigo"] == "NOT_FOUND"


@pytest.mark.parametrize(
    "cuerpo",
    [{"max_productos": 0}, {"max_productos": 501}, {"otro": 1}, None],
)
def test_solicitud_invalida(client, cuerpo):
    response = client.post("/ingest/runs", json=cuerpo)
    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


def test_off_no_configurado(client, repositorio):
    app.state.ingesta = ServicioIngesta(repositorio, None, "https://x")
    response = client.post("/ingest/runs", json={})
    assert response.status_code == 503


@pytest.mark.anyio
async def test_no_lanza_dos_ingestas_a_la_vez(tmp_path, off_falso):
    repo = RepositorioCache(str(tmp_path / "c.sqlite3"))
    repo.inicializar()
    servicio = ServicioIngesta(repo, off_falso, "https://x")
    solicitud = SolicitudIngesta()
    primera, es_nueva = await servicio.iniciar(solicitud)
    segunda, otra_nueva = await servicio.iniciar(solicitud)
    assert (es_nueva, otra_nueva) == (True, False)
    assert segunda.run_id == primera.run_id
    await servicio.ejecutar(primera, solicitud)
    tercera, nueva = await servicio.iniciar(solicitud)
    assert nueva and tercera.run_id != primera.run_id


def test_ingesta_interrumpida_se_marca_fallida_al_reiniciar(
    tmp_path, monkeypatch
):
    ruta = str(tmp_path / "cache.sqlite3")
    repo = RepositorioCache(ruta)
    repo.inicializar()
    run_id = uuid.uuid4()
    repo.guardar_ejecucion(ResumenIngesta(
        run_id=run_id, inicio=datetime.now(timezone.utc), recuperados=0,
        validos=0, invalidos=0, duplicados=0, errores=0, estado="en_curso",
    ))
    monkeypatch.setattr(config.settings, "cache_db_path", ruta)
    monkeypatch.setattr(config.settings, "off_user_agent", None)
    with TestClient(app):
        pass
    assert repo.obtener_ejecucion(run_id).estado == "fallido"


def test_openapi_documenta_ingesta(client):
    rutas = client.get("/openapi.json").json()["paths"]
    respuestas = rutas["/ingest/runs"]["post"]["responses"]
    assert set(respuestas) == {"202", "403", "422", "500", "503"}
    assert "404" in rutas["/ingest/runs/latest"]["get"]["responses"]
