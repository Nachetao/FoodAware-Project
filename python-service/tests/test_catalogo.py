import uuid
from datetime import datetime, timezone

import pytest

from app.core.errores import FuenteNoDisponible, FuenteTimeout
from app.main import app
from app.schemas.busqueda import RespuestaBusqueda
from app.schemas.ingesta import ResumenIngesta
from app.schemas.producto import Producto
from app.services.catalogo import ServicioCatalogo
from tests.payloads_off import LECHE as PAYLOAD_LECHE
from tests.payloads_off import productos_de_ejemplo

LECHE = "7801234000018"
PAN = "7805678000023"


def registrar_ingesta(repositorio, estado):
    inicio = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)
    repositorio.guardar_ejecucion(ResumenIngesta(
        run_id=uuid.uuid4(), inicio=inicio, fin=inicio, recuperados=0,
        validos=0, invalidos=0, duplicados=0, errores=0, estado=estado,
    ))


# --- GET /products/{codigo_barras} -------------------------------------


def test_producto_en_cache_no_consulta_off(client, catalogo_sembrado,
                                           off_falso):
    response = client.get(f"/products/{LECHE}")
    assert response.status_code == 200
    assert "X-Stub" not in response.headers
    assert Producto.model_validate(response.json()).alergenos == ["lacteos"]
    assert off_falso.llamadas == []


def test_producto_fuera_de_cache_se_trae_de_off_y_se_guarda(
    client, off_falso, repositorio
):
    codigo = PAYLOAD_LECHE["code"]
    off_falso.productos[codigo] = PAYLOAD_LECHE
    response = client.get(f"/products/{codigo}")
    assert response.status_code == 200
    datos = response.json()
    assert datos["nombre"] == "Leche entera"
    assert datos["procedencia"]["fuente"] == "openfoodfacts"
    assert repositorio.obtener_payload_off(codigo) == PAYLOAD_LECHE
    # La segunda lectura sale de la caché.
    client.get(f"/products/{codigo}")
    assert off_falso.llamadas == [("producto", codigo)]


def test_producto_inexistente_en_off(client):
    response = client.get("/products/7800000000000",
                          headers={"X-Request-ID": "req-404"})
    assert response.status_code == 404
    assert response.json()["error"] == {
        "codigo": "NOT_FOUND",
        "mensaje": "El producto 7800000000000 no existe en Open Food Facts",
        "request_id": "req-404",
    }


@pytest.mark.parametrize(
    "error, status, codigo",
    [
        (FuenteNoDisponible("Open Food Facts no está disponible"), 503,
         "SOURCE_UNAVAILABLE"),
        (FuenteTimeout("Open Food Facts no respondió a tiempo"), 504,
         "SOURCE_TIMEOUT"),
    ],
)
def test_caida_de_off_sin_cache(client, off_falso, repositorio, error,
                                status, codigo):
    off_falso.productos["7802920000015"] = error
    response = client.get("/products/7802920000015")
    assert response.status_code == status
    assert response.json()["error"]["codigo"] == codigo
    registrados = repositorio.listar_errores_fuente()
    assert [e.tipo for e in registrados] == [codigo]
    assert "7802920000015" in registrados[0].mensaje


def test_caida_de_off_con_producto_en_cache(client, catalogo_sembrado,
                                            off_falso):
    off_falso.productos[LECHE] = FuenteNoDisponible("caída")
    assert client.get(f"/products/{LECHE}").status_code == 200


def test_off_no_configurado(client, repositorio):
    app.state.catalogo = ServicioCatalogo(repositorio, None, "https://x")
    response = client.get("/products/7802920000015")
    assert response.status_code == 503
    assert "OFF_USER_AGENT" in response.json()["error"]["mensaje"]


def test_payload_sin_codigo_valido_es_no_encontrado(client, off_falso):
    off_falso.productos["7802920000015"] = {**PAYLOAD_LECHE, "code": "12"}
    assert client.get("/products/7802920000015").status_code == 404


@pytest.mark.parametrize("codigo", ["1234567", "123456789012345", "78a"])
def test_codigo_barras_invalido(client, codigo):
    response = client.get(f"/products/{codigo}")
    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


# --- GET /search -----------------------------------------------------------


def test_busqueda_en_cache(client, catalogo_sembrado, off_falso):
    response = client.get("/search", params={"q": "leche"})
    assert response.status_code == 200
    assert "X-Stub" not in response.headers
    datos = RespuestaBusqueda.model_validate(response.json())
    assert datos.total == 1
    assert datos.resultados[0].producto.codigo_barras == LECHE
    assert datos.resultados[0].posicion == 1
    # /search nunca consulta OFF en vivo.
    assert off_falso.llamadas == []


def test_busqueda_ignora_tildes_y_mayusculas(client, catalogo_sembrado):
    datos = client.get("/search", params={"q": "AZÚCAR"}).json()
    codigos = {r["producto"]["codigo_barras"] for r in datos["resultados"]}
    assert PAN in codigos and datos["total"] == 2


def test_busqueda_ordena_y_pagina(client, catalogo_sembrado):
    primero = client.get(
        "/search", params={"q": "pan integral"}
    ).json()["resultados"][0]
    assert primero["producto"]["codigo_barras"] == PAN
    assert primero["score"] == 2
    datos = client.get(
        "/search", params={"q": "trigo", "limit": 1, "offset": 1}
    ).json()
    assert datos["total"] == 2
    assert [r["posicion"] for r in datos["resultados"]] == [2]


def test_busqueda_excluye_productos_invalidos(client, repositorio):
    producto = Producto.model_validate({
        **catalogo_json(LECHE),
        "calidad": {"es_valido": False, "problemas": ["sin_ingredientes"],
                    "completitud": 0.5},
    })
    repositorio.guardar_producto(producto, {})
    assert client.get("/search", params={"q": "leche"}).json()["total"] == 0


@pytest.mark.parametrize(
    "estado, esperado",
    [(None, "cache"), ("completado", "online"),
     ("completado_con_errores", "online"), ("fallido", "cache")],
)
def test_estado_fuente_segun_ultima_ingesta(client, repositorio, estado,
                                            esperado):
    if estado:
        registrar_ingesta(repositorio, estado)
    datos = client.get("/search", params={"q": "leche"}).json()
    assert datos["estado_fuente"] == esperado


@pytest.mark.parametrize(
    "params",
    [{}, {"q": "a"}, {"q": "a" * 101}, {"q": "leche", "limit": 0},
     {"q": "leche", "limit": 51}, {"q": "leche", "offset": -1}],
)
def test_busqueda_parametros_invalidos(client, params):
    response = client.get("/search", params=params)
    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


def test_openapi_documenta_errores(client):
    rutas = client.get("/openapi.json").json()["paths"]
    busqueda = rutas["/search"]["get"]
    limit = next(p for p in busqueda["parameters"] if p["name"] == "limit")
    assert limit["schema"]["default"] == 10
    assert set(busqueda["responses"]) == {"200", "422", "500", "503", "504"}
    producto = rutas["/products/{codigo_barras}"]["get"]["responses"]
    assert producto["404"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/RespuestaError"
    }


def catalogo_json(codigo):
    producto = next(p for p in productos_de_ejemplo()
                    if p.codigo_barras == codigo)
    return producto.model_dump(mode="json")
