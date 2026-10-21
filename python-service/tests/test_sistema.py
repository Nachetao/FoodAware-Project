import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.logs import SERVICIO
from app.schemas.ingesta import ResumenIngesta
from app.schemas.sistema import RespuestaSalud
from app.services.salud import (
    VENTANA_FALLA_RECIENTE,
    estado_global,
    estado_indice,
    estado_openfoodfacts,
)

AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def ejecucion(estado, fin=AHORA - timedelta(hours=1)):
    return ResumenIngesta(
        run_id=uuid.uuid4(), inicio=fin - timedelta(minutes=5), fin=fin,
        duracion_ms=300000, recuperados=10, validos=10, invalidos=0,
        duplicados=0, errores=0 if estado == "completado" else 1,
        estado=estado,
    )


def test_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "Servicio FastAPI activo"}


# --- decisiones puras -----------------------------------------------------

@pytest.mark.parametrize(
    "cache, indice, openfoodfacts, esperado",
    [
        ("ok", "ok", "ok", "ok"),
        ("ok", "ok", "no_verificado", "ok"),
        ("ok", "ok", "degradado", "degradado"),
        ("ok", "degradado", "ok", "degradado"),
        ("ok", "degradado", "no_verificado", "degradado"),
        ("ok", "degradado", "degradado", "degradado"),
        ("ok", "error", "ok", "degradado"),
        ("ok", "error", "no_verificado", "degradado"),
        ("ok", "error", "degradado", "degradado"),
        ("error", "ok", "ok", "error"),
        ("error", "ok", "no_verificado", "error"),
        ("error", "ok", "degradado", "error"),
        ("error", "degradado", "ok", "error"),
        ("error", "degradado", "no_verificado", "error"),
        ("error", "degradado", "degradado", "error"),
        ("error", "error", "ok", "error"),
        ("error", "error", "no_verificado", "error"),
        ("error", "error", "degradado", "error"),
    ],
)
def test_estado_global(cache, indice, openfoodfacts, esperado):
    dependencias = {"cache": cache, "indice": indice,
                    "openfoodfacts": openfoodfacts}
    assert estado_global(dependencias) == esperado


@pytest.mark.parametrize(
    "cargado, productos, esperado",
    [(True, 12, "ok"), (True, 0, "degradado"), (False, 0, "error")],
)
def test_estado_indice(cargado, productos, esperado):
    assert estado_indice(cargado, productos) == esperado


RECIENTE = AHORA - timedelta(minutes=5)
ANTIGUA = AHORA - VENTANA_FALLA_RECIENTE - timedelta(minutes=1)


@pytest.mark.parametrize(
    "ultima, ultima_falla, esperado",
    [
        # Nunca hubo ingesta.
        (None, None, "no_verificado"),
        (None, ANTIGUA, "no_verificado"),
        # Sin ingestas, pero OFF falló hace poco (p. ej. GET /products).
        (None, RECIENTE, "degradado"),
        (ejecucion("completado"), None, "ok"),
        (ejecucion("completado_con_errores"), None, "degradado"),
        (ejecucion("fallido"), None, "degradado"),
        # Falla reciente después de una ingesta que terminó bien.
        (ejecucion("completado"), RECIENTE, "degradado"),
        (ejecucion("completado"), ANTIGUA, "ok"),
        # Falla durante una ingesta que igual terminó bien (recuperada).
        (ejecucion("completado", fin=AHORA - timedelta(minutes=1)),
         RECIENTE, "ok"),
    ],
)
def test_estado_openfoodfacts(ultima, ultima_falla, esperado):
    assert estado_openfoodfacts(ultima, ultima_falla, AHORA) == esperado


# --- GET /health ----------------------------------------------------------

def salud(client, status=200):
    response = client.get("/health")
    assert response.status_code == status
    return RespuestaSalud.model_validate(response.json())


def test_health_ok(client, catalogo_sembrado, repositorio):
    repositorio.guardar_ejecucion(ejecucion("completado",
                                            fin=datetime.now(timezone.utc)))
    respuesta = salud(client)
    assert respuesta.estado == "ok"
    assert respuesta.dependencias == {
        "cache": "ok", "indice": "ok", "openfoodfacts": "ok",
    }
    # El mismo nombre que el campo service de los logs.
    assert respuesta.servicio == SERVICIO == "python-service"
    assert respuesta.version == "0.1.0"
    assert respuesta.detalle.cache.productos == len(catalogo_sembrado)
    assert respuesta.detalle.indice.cargado
    assert respuesta.detalle.indice.productos > 0
    assert respuesta.detalle.openfoodfacts.ultima_ingesta == "completado"
    assert respuesta.detalle.openfoodfacts.ultima_falla is None


def test_health_sin_ingestas_es_ok_no_verificado(client, catalogo_sembrado):
    respuesta = salud(client)
    assert respuesta.estado == "ok"
    assert respuesta.dependencias["openfoodfacts"] == "no_verificado"
    assert respuesta.detalle.openfoodfacts.ultima_ingesta is None


def test_health_ingesta_con_errores_es_degradado(
    client, catalogo_sembrado, repositorio
):
    repositorio.guardar_ejecucion(ejecucion("completado_con_errores",
                                            fin=datetime.now(timezone.utc)))
    respuesta = salud(client)
    assert respuesta.estado == "degradado"
    assert respuesta.dependencias == {
        "cache": "ok", "indice": "ok", "openfoodfacts": "degradado",
    }


def test_health_falla_reciente_es_degradado(
    client, catalogo_sembrado, repositorio
):
    repositorio.guardar_ejecucion(ejecucion(
        "completado", fin=datetime.now(timezone.utc) - timedelta(hours=2)
    ))
    repositorio.registrar_error_fuente("SOURCE_UNAVAILABLE", "HTTP 503")
    respuesta = salud(client)
    assert respuesta.estado == "degradado"
    assert respuesta.dependencias["openfoodfacts"] == "degradado"
    assert respuesta.detalle.openfoodfacts.ultima_falla is not None


def test_health_indice_vacio_es_degradado(client, busqueda, repositorio):
    busqueda.reconstruir_ahora()  # la caché está vacía
    repositorio.guardar_ejecucion(ejecucion("completado",
                                            fin=datetime.now(timezone.utc)))
    respuesta = salud(client)
    assert respuesta.estado == "degradado"
    assert respuesta.dependencias == {
        "cache": "ok", "indice": "degradado", "openfoodfacts": "ok",
    }
    assert respuesta.detalle.indice.model_dump() == {"cargado": True,
                                                     "productos": 0}


def test_health_indice_sin_cargar_es_degradado(client):
    # El fixture `client` reemplaza el buscador por uno sin construir.
    respuesta = salud(client)
    assert respuesta.estado == "degradado"
    assert respuesta.dependencias["indice"] == "error"
    assert not respuesta.detalle.indice.cargado


def test_health_cache_caida_es_503(
    client, catalogo_sembrado, repositorio, tmp_path, monkeypatch, caplog
):
    monkeypatch.setattr(repositorio, "ruta", str(tmp_path / "no-existe.db"))
    with caplog.at_level(logging.ERROR):
        respuesta = salud(client, status=503)
    assert respuesta.estado == "error"
    assert respuesta.dependencias == {
        "cache": "error", "indice": "ok", "openfoodfacts": "no_verificado",
    }
    assert respuesta.detalle.cache.productos is None
    assert "La caché no responde" in caplog.text
    # No la crea al verificarla.
    assert not (tmp_path / "no-existe.db").exists()


def test_health_no_consulta_open_food_facts(client, off_falso):
    salud(client)
    assert off_falso.llamadas == []
