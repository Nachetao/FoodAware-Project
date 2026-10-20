import pytest

from app.core import config

PRODUCTO = "/products/7801234000018"


@pytest.fixture
def simulacion_activa(monkeypatch):
    monkeypatch.setattr(config.settings, "simular_errores_habilitado", True)


def test_header_se_ignora_por_defecto(client):
    response = client.get(
        PRODUCTO, headers={"X-Simular-Error": "SOURCE_UNAVAILABLE"}
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "valor, status",
    [
        ("SOURCE_UNAVAILABLE", 503),
        ("SOURCE_TIMEOUT", 504),
        ("INTERNAL_ERROR", 500),
        ("OTRO", 422),
    ],
)
@pytest.mark.parametrize(
    "metodo, ruta",
    [("get", PRODUCTO), ("get", "/search?q=leche")],
)
def test_simula_errores_en_rutas_stub(
    client, simulacion_activa, valor, status, metodo, ruta
):
    response = client.request(
        metodo, ruta, json={}, headers={"X-Simular-Error": valor,
                                        "X-Request-ID": "sim-1"}
    )
    assert response.status_code == status
    assert response.json()["error"]["request_id"] == "sim-1"
    assert response.headers["X-Stub"] == "true"


def test_rutas_legadas_no_simulan(client, simulacion_activa):
    headers = {"X-Simular-Error": "SOURCE_UNAVAILABLE"}
    assert client.get("/health", headers=headers).status_code == 200
    response = client.post(
        "/analizar", json={"nombre": "P", "ingredientes": ["avena"]},
        headers=headers,
    )
    assert response.status_code == 200


def test_header_oculto_en_openapi(client):
    assert "X-Simular-Error" not in client.get("/openapi.json").text


@pytest.mark.parametrize("valor, esperado", [("true", True), ("false", False)])
def test_variable_de_entorno(monkeypatch, valor, esperado):
    monkeypatch.setenv("SIMULAR_ERRORES_HABILITADO", valor)
    assert config.Settings().simular_errores_habilitado is esperado


def test_variable_desactivada_si_no_existe(monkeypatch):
    monkeypatch.delenv("SIMULAR_ERRORES_HABILITADO", raising=False)
    assert config.Settings().simular_errores_habilitado is False
