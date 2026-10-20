import pytest

from app.schemas.busqueda import RespuestaBusqueda
from app.schemas.producto import Producto
from app.services.catalogo_stub import cargar_productos

LECHE = "7801234000018"
PAN = "7805678000023"


def test_fixtures_cumplen_el_contrato():
    productos = cargar_productos()
    assert len(productos) == 3
    alergenos = {a.value for p in productos for a in p.alergenos}
    assert {"lacteos", "gluten"} <= alergenos


def test_obtener_producto(client):
    response = client.get(f"/products/{LECHE}")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    producto = Producto.model_validate(response.json())
    assert producto.alergenos == ["lacteos"]


def test_producto_inexistente(client):
    response = client.get("/products/7800000000000",
                          headers={"X-Request-ID": "req-404"})
    assert response.status_code == 404
    assert response.headers["X-Stub"] == "true"
    assert response.json() == {"error": {
        "codigo": "NOT_FOUND",
        "mensaje": "Producto 7800000000000 no encontrado",
        "request_id": "req-404",
    }}


@pytest.mark.parametrize("codigo", ["1234567", "123456789012345", "78a"])
def test_codigo_barras_invalido(client, codigo):
    response = client.get(f"/products/{codigo}")
    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


def test_busqueda(client):
    response = client.get("/search", params={"q": "leche"})
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    datos = RespuestaBusqueda.model_validate(response.json())
    assert datos.consulta == "leche"
    assert datos.estado_fuente == "online"
    assert datos.total == 1
    assert datos.resultados[0].producto.codigo_barras == LECHE
    assert datos.resultados[0].posicion == 1


def test_busqueda_ignora_tildes_y_mayusculas(client):
    datos = client.get("/search", params={"q": "AZÚCAR"}).json()
    codigos = {r["producto"]["codigo_barras"] for r in datos["resultados"]}
    assert PAN in codigos and datos["total"] == 2


def test_busqueda_ordena_por_score(client):
    datos = client.get("/search", params={"q": "pan integral"}).json()
    primero = datos["resultados"][0]
    assert primero["producto"]["codigo_barras"] == PAN
    assert primero["score"] == 2


def test_busqueda_paginada(client):
    datos = client.get(
        "/search", params={"q": "trigo", "limit": 1, "offset": 1}
    ).json()
    assert datos["total"] == 2
    assert len(datos["resultados"]) == 1
    assert datos["resultados"][0]["posicion"] == 2


def test_busqueda_sin_resultados(client):
    datos = client.get("/search", params={"q": "quinoa"}).json()
    assert datos["total"] == 0 and datos["resultados"] == []


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"q": "a"},
        {"q": "a" * 101},
        {"q": "leche", "limit": 0},
        {"q": "leche", "limit": 51},
        {"q": "leche", "offset": -1},
    ],
)
def test_busqueda_parametros_invalidos(client, params):
    response = client.get("/search", params=params)
    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"
    assert response.headers["X-Stub"] == "true"


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
