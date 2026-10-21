"""Refresco por TTL y tope de espera del limitador en GET /products."""
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import respx

from app.clients.limitador import LimitadorTasa
from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core import config
from app.core.errores import FuenteNoDisponible, FuenteTimeout, NoEncontrado
from app.main import app
from app.services.catalogo import ServicioCatalogo
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import LECHE

BASE_OFF = "https://world.openfoodfacts.org"
CODIGO = LECHE["code"]


def guardar_en_cache(repositorio, horas_desde_verificacion, payload=LECHE):
    verificado = (datetime.now(timezone.utc)
                  - timedelta(hours=horas_desde_verificacion))
    producto = mapear_producto(
        payload, run_id=uuid.uuid4(), recuperado_en=verificado,
        base_url=BASE_OFF,
    )
    repositorio.guardar_producto(producto, payload, verificado)
    return producto


def test_producto_vigente_no_consulta_off(client, repositorio, off_falso):
    guardar_en_cache(repositorio, horas_desde_verificacion=1)
    assert client.get(f"/products/{CODIGO}").status_code == 200
    assert off_falso.llamadas == []


def test_producto_vencido_se_refresca(client, repositorio, off_falso):
    guardar_en_cache(repositorio, horas_desde_verificacion=100)
    off_falso.productos[CODIGO] = {**LECHE, "quantity": "2 L"}
    response = client.get(f"/products/{CODIGO}")
    assert response.status_code == 200
    assert response.json()["cantidad"] == "2 L"
    assert repositorio.obtener_producto(CODIGO).producto.cantidad == "2 L"


def test_refresco_sin_cambios_conserva_procedencia(client, repositorio,
                                                   off_falso):
    original = guardar_en_cache(repositorio, horas_desde_verificacion=100)
    off_falso.productos[CODIGO] = LECHE
    datos = client.get(f"/products/{CODIGO}").json()
    assert datos["procedencia"]["run_id"] == str(original.procedencia.run_id)
    cacheado = repositorio.obtener_producto(CODIGO)
    edad = datetime.now(timezone.utc) - cacheado.verificado_en
    assert edad < timedelta(minutes=1)


@pytest.mark.parametrize(
    "error",
    [FuenteNoDisponible("caída"), FuenteTimeout("lento"),
     NoEncontrado("ya no existe")],
)
def test_producto_vencido_sin_fuente_devuelve_cache(client, repositorio,
                                                    off_falso, error):
    guardar_en_cache(repositorio, horas_desde_verificacion=100)
    off_falso.productos[CODIGO] = error
    response = client.get(f"/products/{CODIGO}")
    assert response.status_code == 200
    assert response.json()["cantidad"] == "1 L"


def test_get_products_pasa_el_tope_de_espera(client, off_falso):
    off_falso.productos[CODIGO] = LECHE
    client.get(f"/products/{CODIGO}")
    assert off_falso.esperas_maximas == [3.0]


def test_limite_alcanzado_responde_503_de_inmediato(client, repositorio):
    """Con el cliente real y un limitador saturado (sin red: respx)."""
    reloj = {"ahora": 0.0}

    async def no_dormir(_segundos):
        raise AssertionError("una petición HTTP no debe esperar")

    cliente = ClienteOpenFoodFacts(
        BASE_OFF, "FoodAware/0.1 (correo@ejemplo.com)",
        limitador_lecturas=LimitadorTasa(1, 60, reloj=lambda: reloj["ahora"],
                                         dormir=no_dormir),
    )
    app.state.catalogo = ServicioCatalogo(repositorio, cliente, BASE_OFF,
                                          espera_maxima=3)
    with respx.mock(base_url=BASE_OFF) as off:
        off.get(url__regex=r"/api/v3/product/\d+").respond(
            200, json={"status": "success", "product": LECHE}
        )
        assert client.get(f"/products/{CODIGO}").status_code == 200
        inicio = time.monotonic()
        response = client.get("/products/7802215000040",
                              headers={"X-Request-ID": "lim-1"})
        assert time.monotonic() - inicio < 2
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["codigo"] == "SOURCE_UNAVAILABLE"
    assert "límite de consultas" in error["mensaje"]
    assert error["request_id"] == "lim-1"
    registrados = repositorio.listar_errores_fuente()
    assert "límite de consultas" in registrados[0].mensaje


@pytest.mark.parametrize(
    "variable, campo, valor, esperado",
    [
        ("LIMITADOR_ESPERA_MAX_SEGUNDOS", "limitador_espera_max_segundos",
         "5", 5.0),
        ("CACHE_TTL_HORAS", "cache_ttl_horas", "12", 12.0),
        ("INGESTA_AL_INICIAR", "ingesta_al_iniciar", "false", False),
        ("INGESTA_INTERVALO_HORAS", "ingesta_intervalo_horas", "6", 6.0),
    ],
)
def test_variables_de_entorno(monkeypatch, variable, campo, valor, esperado):
    monkeypatch.setenv(variable, valor)
    assert getattr(config.Settings(), campo) == esperado


def test_valores_por_defecto():
    valores = config.Settings(_env_file=None)
    assert valores.limitador_espera_max_segundos == 3.0
    assert valores.cache_ttl_horas == 72.0
    assert valores.ingesta_al_iniciar is True
    assert valores.ingesta_intervalo_horas == 24.0
