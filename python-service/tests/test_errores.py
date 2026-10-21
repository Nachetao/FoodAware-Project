import uuid

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.core.errores import (
    FuenteNoDisponible,
    FuenteTimeout,
    NoEncontrado,
    registrar_manejadores_error,
)
from app.core.request_id import RequestIdMiddleware
from app.schemas.sistema import RespuestaError


def crear_app_prueba():
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)
    registrar_manejadores_error(app)
    rutas = APIRouter()

    @rutas.get("/prueba/{caso}")
    def lanzar(caso: str, n: int = 1):
        errores = {
            "404": NoEncontrado("Producto no encontrado"),
            "503": FuenteNoDisponible("Fuente caída"),
            "504": FuenteTimeout("Fuente lenta"),
            "500": RuntimeError("fallo inesperado"),
        }
        if caso in errores:
            raise errores[caso]
        return {"ok": True}

    @app.get("/normal")
    def normal():
        return {"ok": True}

    app.include_router(rutas)
    return app


@pytest.fixture
def prueba():
    return TestClient(crear_app_prueba(), raise_server_exceptions=False)


def es_uuid4(valor):
    return uuid.UUID(valor).version == 4


@pytest.mark.parametrize("valor", ["", "con espacios", "x" * 129, "a;b"])
def test_request_id_ausente_o_invalido_se_genera(prueba, valor):
    response = prueba.get("/normal", headers={"X-Request-ID": valor})
    assert es_uuid4(response.headers["X-Request-ID"])


@pytest.mark.parametrize(
    "caso, status, codigo",
    [
        ("404", 404, "NOT_FOUND"),
        ("503", 503, "SOURCE_UNAVAILABLE"),
        ("504", 504, "SOURCE_TIMEOUT"),
        ("500", 500, "INTERNAL_ERROR"),
    ],
)
def test_errores_uniformes(prueba, caso, status, codigo):
    response = prueba.get(f"/prueba/{caso}", headers={"X-Request-ID": "r-1"})
    assert response.status_code == status
    cuerpo = RespuestaError.model_validate(response.json())
    assert cuerpo.error.codigo == codigo
    assert cuerpo.error.request_id == "r-1"
    assert "fallo inesperado" not in cuerpo.error.mensaje
    assert response.headers["X-Request-ID"] == "r-1"
    assert "X-Stub" not in response.headers


def test_validacion_devuelve_validation_error(prueba):
    response = prueba.get("/prueba/ok?n=abc")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["codigo"] == "VALIDATION_ERROR"
    assert "query.n" in error["mensaje"]
    assert error["request_id"] == response.headers["X-Request-ID"]


def test_ruta_inexistente_devuelve_not_found(prueba):
    response = prueba.get("/no-existe")
    assert response.status_code == 404
    assert response.json()["error"]["codigo"] == "NOT_FOUND"


def test_metodo_no_permitido_conserva_allow(prueba):
    response = prueba.post("/normal")
    assert response.status_code == 405
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"
    assert response.headers["allow"] == "GET"


def test_rutas_legadas_conservan_errores_de_fastapi(client):
    response = client.post("/analizar", json={"nombre": "Sin ingredientes"})
    assert response.status_code == 422
    assert "detail" in response.json()
    assert es_uuid4(response.headers["X-Request-ID"])


def test_health_tiene_request_id(client):
    response = client.get("/health", headers={"X-Request-ID": "salud-1"})
    assert response.json()["servicio"] == "python-service"
    assert response.headers["X-Request-ID"] == "salud-1"
    assert "X-Stub" not in response.headers
