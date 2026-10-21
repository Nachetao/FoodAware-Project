import logging

import httpx
import pytest
import respx

from app.clients.limitador import LimitadorTasa
from app.clients.open_food_facts import CAMPOS, ClienteOpenFoodFacts
from app.core import config
from app.core.errores import FuenteNoDisponible, FuenteTimeout, NoEncontrado

pytestmark = pytest.mark.anyio

BASE = "https://off.test"
UA = "FoodAware/0.1 (correo@ejemplo.com)"
CODIGO = "7801234000018"
RUTA_PRODUCTO = f"/api/v3/product/{CODIGO}"
PRODUCTO_OK = {
    "code": CODIGO,
    "status": "success",
    "product": {"code": CODIGO, "product_name": "Leche semidescremada"},
}


class LimitadorContador:
    def __init__(self):
        self.turnos = 0
        self.esperas_maximas = []

    async def esperar_turno(self, espera_maxima=None):
        self.turnos += 1
        self.esperas_maximas.append(espera_maxima)


@pytest.fixture
def esperas():
    return []


@pytest.fixture
def lecturas():
    return LimitadorContador()


@pytest.fixture
def busquedas():
    return LimitadorContador()


@pytest.fixture
async def cliente(esperas, lecturas, busquedas):
    async def dormir(segundos):
        esperas.append(segundos)

    cliente = ClienteOpenFoodFacts(
        BASE, UA, 5,
        limitador_lecturas=lecturas, limitador_busquedas=busquedas,
        dormir=dormir, aleatorio=lambda: 0.5,
    )
    yield cliente
    await cliente.cerrar()


@pytest.fixture
def off():
    with respx.mock(base_url=BASE, assert_all_called=False) as mock:
        yield mock


async def test_obtener_producto(cliente, off, lecturas, busquedas):
    ruta = off.get(RUTA_PRODUCTO).respond(200, json=PRODUCTO_OK)
    producto = await cliente.obtener_producto(CODIGO)
    assert producto["product_name"] == "Leche semidescremada"
    peticion = ruta.calls.last.request
    assert peticion.headers["User-Agent"] == UA
    assert peticion.url.params["fields"] == ",".join(CAMPOS)
    assert (lecturas.turnos, busquedas.turnos) == (1, 0)


async def test_404_es_no_encontrado_sin_reintentos(cliente, off, esperas):
    ruta = off.get(RUTA_PRODUCTO).respond(
        404, json={"status": "failure", "result": {"id": "product_not_found"}}
    )
    with pytest.raises(NoEncontrado):
        await cliente.obtener_producto(CODIGO)
    assert ruta.call_count == 1
    assert esperas == []


async def test_status_failure_es_no_encontrado(cliente, off):
    off.get(RUTA_PRODUCTO).respond(200, json={"status": "failure"})
    with pytest.raises(NoEncontrado):
        await cliente.obtener_producto(CODIGO)


async def test_redireccion_a_otro_producto_es_no_encontrado(cliente, off):
    ruta = off.get(RUTA_PRODUCTO).respond(
        302, headers={"Location": "https://world.openbeautyfacts.org/x"}
    )
    with pytest.raises(NoEncontrado):
        await cliente.obtener_producto(CODIGO)
    assert ruta.call_count == 1


async def test_429_reintenta_respetando_retry_after(
    cliente, off, esperas, lecturas
):
    ruta = off.get(RUTA_PRODUCTO)
    ruta.side_effect = [
        httpx.Response(429, headers={"Retry-After": "5"}),
        httpx.Response(200, json=PRODUCTO_OK),
    ]
    producto = await cliente.obtener_producto(CODIGO)
    assert producto["code"] == CODIGO
    assert ruta.call_count == 2
    assert esperas == [5.0]
    # Cada intento consume un turno del limitador.
    assert lecturas.turnos == 2


async def test_503_agota_reintentos_con_backoff(cliente, off, esperas, caplog):
    ruta = off.get(RUTA_PRODUCTO).respond(503)
    with caplog.at_level(logging.WARNING):
        with pytest.raises(FuenteNoDisponible):
            await cliente.obtener_producto(CODIGO)
    assert ruta.call_count == 4
    assert esperas == [1.5, 2.5, 4.5]
    errores = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errores) == 1 and "HTTP 503" in errores[0].getMessage()


async def test_timeout_agota_reintentos(cliente, off):
    ruta = off.get(RUTA_PRODUCTO)
    ruta.side_effect = httpx.ReadTimeout("lento")
    with pytest.raises(FuenteTimeout):
        await cliente.obtener_producto(CODIGO)
    assert ruta.call_count == 4


async def test_error_de_red_reintenta(cliente, off):
    ruta = off.get(RUTA_PRODUCTO)
    ruta.side_effect = [
        httpx.ConnectError("sin red"),
        httpx.Response(200, json=PRODUCTO_OK),
    ]
    assert (await cliente.obtener_producto(CODIGO))["code"] == CODIGO
    assert ruta.call_count == 2


@pytest.mark.parametrize("estado", [400, 401, 403])
async def test_otros_4xx_no_se_reintentan(cliente, off, esperas, estado):
    ruta = off.get(RUTA_PRODUCTO).respond(estado)
    with pytest.raises(FuenteNoDisponible):
        await cliente.obtener_producto(CODIGO)
    assert ruta.call_count == 1
    assert esperas == []


@pytest.mark.parametrize("cuerpo", [b"<html>", b"[]", b'{"status":"ok"}'])
async def test_respuesta_invalida(cliente, off, cuerpo):
    off.get(RUTA_PRODUCTO).respond(200, content=cuerpo)
    with pytest.raises(FuenteNoDisponible):
        await cliente.obtener_producto(CODIGO)


async def test_buscar_por_pais(cliente, off, lecturas, busquedas):
    ruta = off.get("/api/v2/search").respond(
        200, json={"count": 1, "page": 2, "page_size": 20,
                   "products": [{"code": CODIGO}]}
    )
    datos = await cliente.buscar_por_pais(
        "chile", ["en:dairies", "en:breads"], pagina=2, tamano_pagina=20
    )
    assert datos["products"] == [{"code": CODIGO}]
    params = ruta.calls.last.request.url.params
    assert params["countries_tags"] == "en:chile"
    assert params["categories_tags"] == "en:dairies|en:breads"
    assert (params["page"], params["page_size"]) == ("2", "20")
    assert params["sort_by"] == "last_modified_t"
    assert params["fields"] == ",".join(CAMPOS)
    assert (lecturas.turnos, busquedas.turnos) == (0, 1)


async def test_buscar_sin_categorias_no_envia_filtro(cliente, off):
    ruta = off.get("/api/v2/search").respond(200, json={"products": []})
    await cliente.buscar_por_pais("chile")
    assert "categories_tags" not in ruta.calls.last.request.url.params


async def test_buscar_respuesta_sin_productos(cliente, off):
    off.get("/api/v2/search").respond(200, json={"count": 0})
    with pytest.raises(FuenteNoDisponible):
        await cliente.buscar_por_pais("chile")


@pytest.mark.parametrize("pagina, tamano", [(0, 20), (1, 0), (1, 101)])
async def test_buscar_parametros_invalidos(cliente, pagina, tamano):
    with pytest.raises(ValueError):
        await cliente.buscar_por_pais("chile", pagina=pagina,
                                      tamano_pagina=tamano)


async def test_espera_maxima_llega_al_limitador_de_lecturas(
    cliente, off, lecturas, busquedas
):
    off.get(RUTA_PRODUCTO).respond(200, json=PRODUCTO_OK)
    off.get("/api/v2/search").respond(200, json={"products": []})
    await cliente.obtener_producto(CODIGO, espera_maxima=3)
    await cliente.buscar_por_pais("chile")
    assert lecturas.esperas_maximas == [3]
    # La búsqueda (usada por la ingesta) espera sin tope.
    assert busquedas.esperas_maximas == [None]


async def test_limite_alcanzado_falla_de_inmediato(off, caplog):
    reloj = {"ahora": 0.0}
    esperas = []

    async def dormir(segundos):
        esperas.append(segundos)

    limitador = LimitadorTasa(1, 60, reloj=lambda: reloj["ahora"],
                              dormir=dormir)
    ruta = off.get(RUTA_PRODUCTO).respond(200, json=PRODUCTO_OK)
    async with ClienteOpenFoodFacts(BASE, UA, limitador_lecturas=limitador,
                                    dormir=dormir) as cliente:
        await cliente.obtener_producto(CODIGO, espera_maxima=3)
        reloj["ahora"] = 10
        with caplog.at_level(logging.WARNING):
            with pytest.raises(FuenteNoDisponible) as error:
                await cliente.obtener_producto(CODIGO, espera_maxima=3)
    assert error.value.mensaje == (
        "Se alcanzó el límite de consultas a Open Food Facts; intenta de "
        "nuevo en 50 s"
    )
    assert ruta.call_count == 1
    assert esperas == []
    assert any("Límite de consultas" in r.getMessage()
               for r in caplog.records)


@pytest.mark.parametrize(
    "user_agent",
    [None, "", "FoodAware", "FoodAware/0.1", "FoodAware/0.1 (sin-correo)"],
)
def test_user_agent_obligatorio_con_formato(user_agent):
    with pytest.raises(ValueError):
        ClienteOpenFoodFacts(BASE, user_agent)


async def test_desde_settings_lee_variables_de_entorno(monkeypatch):
    monkeypatch.setenv("OFF_BASE_URL", BASE)
    monkeypatch.setenv("OFF_USER_AGENT", UA)
    monkeypatch.setenv("OFF_TIMEOUT_SEGUNDOS", "3.5")
    cliente = ClienteOpenFoodFacts.desde_settings(config.Settings())
    async with cliente:
        assert str(cliente._http.base_url) == BASE
        assert cliente._http.timeout.read == 3.5
