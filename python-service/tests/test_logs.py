import asyncio
import io
import json
import logging
import uuid
from datetime import datetime

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core import config
from app.core.errores import FuenteNoDisponible, registrar_manejadores_error
from app.core.logs import (
    CORREO_OCULTO,
    FormateadorJSON,
    configurar_logs,
    contexto_ejecucion,
)
from app.core.request_id import RequestIdMiddleware
from tests.payloads_off import GALLETAS, LECHE

CAMPOS_FIJOS = ["timestamp", "level", "service", "request_id", "message"]
UA = "FoodAware/0.1 (equipo@ejemplo.com)"

logger = logging.getLogger("tests.logs")


@pytest.fixture
def logs():
    """Devuelve una función que lee, ya parseadas, las líneas JSON que el
    servicio escribió durante el test."""
    salida = io.StringIO()
    manejador = logging.StreamHandler(salida)
    manejador.setFormatter(FormateadorJSON())
    raiz = logging.getLogger()
    nivel = raiz.level
    raiz.addHandler(manejador)
    raiz.setLevel(logging.INFO)

    def leer():
        return [json.loads(linea) for linea in salida.getvalue().splitlines()]

    yield leer
    raiz.removeHandler(manejador)
    raiz.setLevel(nivel)


def de_logger(eventos, nombre):
    return [e for e in eventos if e["logger"] == nombre]


def accesos(eventos):
    return [e for e in eventos if e.get("evento") == "acceso_http"]


def crear_app_prueba():
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)
    registrar_manejadores_error(app)

    def tarea_interna():
        # Sin recibir el request_id: lo toma del contexto.
        logger.info("desde una función interna")

    @app.get("/prueba")
    async def prueba():
        tarea_interna()
        await asyncio.to_thread(tarea_interna)
        return {"ok": True}

    @app.get("/falla")
    async def falla():
        raise RuntimeError("se cayó")

    @app.get("/fuente")
    async def fuente():
        raise FuenteNoDisponible("Fuente caída")

    return app


@pytest.fixture
def prueba():
    return TestClient(crear_app_prueba(), raise_server_exceptions=False)


def test_json_con_campos_fijos_y_extra(logs):
    logger.warning("hola %s", "mundo", extra={"categoria": "en:dairies"})
    evento, = logs()
    assert list(evento)[:5] == CAMPOS_FIJOS
    assert evento["timestamp"].endswith("Z")
    assert datetime.fromisoformat(evento["timestamp"].replace("Z", "+00:00"))
    assert evento["level"] == "warning"
    assert evento["service"] == "python-service"
    assert evento["request_id"] is None  # fuera de una petición
    assert evento["message"] == "hola mundo"
    assert evento["categoria"] == "en:dairies"
    assert "run_id" not in evento


def test_excepcion_en_una_sola_linea(logs):
    try:
        raise ValueError("dato malo")
    except ValueError:
        logger.exception("Falló algo")
    evento, = logs()
    assert evento["level"] == "error"
    assert "Traceback" in evento["exception"]
    assert "ValueError: dato malo" in evento["exception"]


def test_nunca_registra_correos(logs):
    logger.error("User-Agent %s", UA, extra={"user_agent": UA,
                                             "lista": [UA]})
    evento, = logs()
    assert "@" not in json.dumps(evento)
    assert evento["message"] == f"User-Agent FoodAware/0.1 ({CORREO_OCULTO})"
    assert evento["lista"] == [f"FoodAware/0.1 ({CORREO_OCULTO})"]


def test_request_id_se_propaga_a_todos_los_logs(prueba, logs):
    response = prueba.get("/prueba", headers={"X-Request-ID": "abc-123"})
    assert response.status_code == 200
    internos = de_logger(logs(), "tests.logs")
    # Incluido el log escrito en otro hilo (asyncio.to_thread).
    assert len(internos) == 2
    assert {e["request_id"] for e in internos} == {"abc-123"}
    assert accesos(logs())[0]["request_id"] == "abc-123"


def test_request_id_generado_coincide_con_el_header(prueba, logs):
    response = prueba.get("/prueba")
    generado = response.headers["X-Request-ID"]
    assert uuid.UUID(generado).version == 4
    # Sin el log del cliente HTTP del test, que no es del servicio.
    del_servicio = [e for e in logs() if e["logger"] != "httpx"]
    assert {e["request_id"] for e in del_servicio} == {generado}


def test_log_de_acceso_y_header_de_tiempo(prueba, logs):
    response = prueba.get("/prueba", headers={"X-Request-ID": "acc-1"})
    acceso, = accesos(logs())
    assert acceso["level"] == "info"
    assert (acceso["metodo"], acceso["ruta"], acceso["codigo_estado"]) == (
        "GET", "/prueba", 200
    )
    assert isinstance(acceso["duracion_ms"], float)
    assert acceso["duracion_ms"] >= 0
    assert float(response.headers["X-Response-Time-ms"]) >= 0


def test_log_de_acceso_de_un_404(prueba, logs):
    response = prueba.get("/no-existe")
    assert response.status_code == 404
    assert "X-Response-Time-ms" in response.headers
    acceso, = accesos(logs())
    assert (acceso["ruta"], acceso["codigo_estado"]) == ("/no-existe", 404)


def test_error_no_controlado_registra_acceso_y_error(prueba, logs):
    response = prueba.get("/falla", headers={"X-Request-ID": "err-1"})
    assert response.status_code == 500
    assert response.headers["X-Request-ID"] == "err-1"
    assert float(response.headers["X-Response-Time-ms"]) >= 0
    eventos = logs()
    acceso, = accesos(eventos)
    assert acceso["codigo_estado"] == 500
    error, = [e for e in eventos if e["message"] == "Error no controlado"]
    assert error["request_id"] == "err-1"
    assert error["level"] == "error"
    assert error["codigo"] == "INTERNAL_ERROR"
    assert "RuntimeError: se cayó" in error["exception"]


def test_error_de_la_fuente_en_una_peticion(prueba, logs):
    response = prueba.get("/fuente", headers={"X-Request-ID": "src-1"})
    assert response.status_code == 503
    aviso, = [e for e in logs() if e["level"] == "warning"]
    assert aviso["request_id"] == "src-1"
    assert (aviso["codigo"], aviso["codigo_estado"]) == (
        "SOURCE_UNAVAILABLE", 503
    )


def test_contexto_de_ejecucion_usa_el_run_id(logs):
    run_id = uuid.uuid4()
    with contexto_ejecucion(run_id):
        logger.info("dentro de la ingesta")
    logger.info("fuera")
    dentro, fuera = logs()
    assert dentro["request_id"] == dentro["run_id"] == str(run_id)
    assert fuera["request_id"] is None and "run_id" not in fuera


def test_ingesta_en_segundo_plano_usa_su_run_id(client, off_falso, logs):
    off_falso.paginas = [{"products": [LECHE, GALLETAS]}, {"products": []}]
    response = client.post("/ingest/runs", json={},
                           headers={"X-Request-ID": "post-1"})
    run_id = response.json()["run_id"]
    eventos = logs()
    iniciada, = [e for e in eventos if "iniciada" in e["message"]]
    # Este log une la petición con la ejecución.
    assert (iniciada["request_id"], iniciada["run_id"]) == ("post-1", run_id)
    de_ingesta = [e for e in de_logger(eventos, "app.services.ingesta")
                  if e is not iniciada]
    assert de_ingesta
    assert {e["request_id"] for e in de_ingesta} == {run_id}
    assert {e["run_id"] for e in de_ingesta} == {run_id}
    terminada, = [e for e in de_ingesta if "terminada" in e["message"]]
    assert terminada["resumen"]["estado"] == "completado"
    # El acceso se registra al enviar el 202, antes que la ingesta.
    acceso, = accesos(eventos)
    assert acceso["request_id"] == "post-1"
    assert acceso["codigo_estado"] == 202
    assert eventos.index(acceso) < eventos.index(terminada)


@pytest.mark.anyio
async def test_falla_de_la_fuente_estructurada(logs):
    async def dormir(_segundos):
        pass

    run_id = uuid.uuid4()
    with respx.mock(base_url="https://off.test") as off:
        off.get("/api/v2/search").respond(503)
        async with ClienteOpenFoodFacts("https://off.test", UA,
                                        dormir=dormir) as cliente:
            with contexto_ejecucion(run_id):
                with pytest.raises(FuenteNoDisponible):
                    await cliente.buscar_por_pais("chile", ["en:dairies"],
                                                  pagina=3)
    fallas = [e for e in logs() if e.get("evento") == "error_fuente"]
    assert [e["level"] for e in fallas] == ["warning"] * 3 + ["error"]
    assert [e["intento"] for e in fallas] == [1, 2, 3, 4]
    final = fallas[-1]
    assert final["categoria"] == "en:dairies"
    assert final["pagina"] == 3
    assert final["codigo_http"] == 503
    assert final["run_id"] == final["request_id"] == str(run_id)
    assert final["motivo"] == "HTTP 503"
    # El User-Agent (con el correo) no aparece en ningún log.
    assert all("@" not in json.dumps(e) for e in logs())


@pytest.mark.anyio
async def test_falla_de_red_sin_ingesta_tiene_run_id_nulo(logs):
    async def dormir(_segundos):
        pass

    with respx.mock(base_url="https://off.test") as off:
        off.get("/api/v3/product/7801234000018").mock(
            side_effect=httpx.ConnectError("sin red")
        )
        async with ClienteOpenFoodFacts("https://off.test", UA,
                                        dormir=dormir) as cliente:
            with pytest.raises(FuenteNoDisponible):
                await cliente.obtener_producto("7801234000018")
    final = [e for e in logs() if e.get("evento") == "error_fuente"][-1]
    assert final["run_id"] is None
    assert final["codigo_http"] is None
    assert final["codigo_barras"] == "7801234000018"
    assert final["motivo"].startswith("error de red")


def test_logs_de_uvicorn_salen_en_json(capsys):
    try:
        configurar_logs("DEBUG")
        assert logging.getLogger().level == logging.DEBUG
        logging.getLogger("uvicorn.error").info(
            "Started server process [%d]", 1,
            extra={"color_message": "\x1b[1mStarted\x1b[0m"},
        )
        logging.getLogger("uvicorn.access").info("duplicado")
        lineas = capsys.readouterr().out.splitlines()
        eventos = [json.loads(linea) for linea in lineas]
        evento, = eventos  # el acceso de uvicorn no se registra
        assert list(evento)[:5] == CAMPOS_FIJOS
        assert evento["message"] == "Started server process [1]"
        assert evento["logger"] == "uvicorn.error"
        assert "color_message" not in evento
    finally:
        configurar_logs(config.settings.log_level)


@pytest.mark.parametrize("valor, esperado",
                         [("debug", "DEBUG"), (" Warning ", "WARNING")])
def test_log_level_desde_el_entorno(monkeypatch, valor, esperado):
    monkeypatch.setenv("LOG_LEVEL", valor)
    assert config.Settings().log_level == esperado


def test_log_level_por_defecto_e_invalido(monkeypatch):
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    assert config.Settings().log_level == "INFO"
    monkeypatch.setenv("LOG_LEVEL", "VERBOSO")
    with pytest.raises(ValidationError):
        config.Settings()
