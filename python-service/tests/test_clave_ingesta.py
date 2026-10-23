"""Clave interna de POST /ingest/runs: cerrado por defecto y sin pistas."""
import pytest
from pydantic import SecretStr

from app.core import clave_ingesta, config
from app.core.clave_ingesta import HEADER_CLAVE_INGESTA
from tests.conftest import CLAVE_INGESTA
from tests.payloads_off import LECHE

MENSAJE = "Se requiere una clave de ingesta válida"


@pytest.fixture
def anonimo(client):
    """El mismo cliente, sin la clave que `client` envía por defecto."""
    del client.headers[HEADER_CLAVE_INGESTA]
    return client


def assert_prohibido(response, request_id=None):
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["codigo"] == "FORBIDDEN"
    # Mismo mensaje en todos los casos: no revela si hay clave configurada.
    assert error["mensaje"] == MENSAJE
    if request_id:
        assert error["request_id"] == request_id


def test_sin_header_responde_403_y_no_inicia_nada(anonimo, off_falso):
    response = anonimo.post("/ingest/runs", json={},
                            headers={"X-Request-ID": "sin-clave"})

    assert_prohibido(response, "sin-clave")
    assert off_falso.llamadas == []
    assert anonimo.get("/ingest/runs/latest").status_code == 404


@pytest.mark.parametrize("clave", ["otra-clave", CLAVE_INGESTA + "x", "",
                                   CLAVE_INGESTA.upper()])
def test_clave_incorrecta_responde_403(anonimo, off_falso, clave):
    response = anonimo.post("/ingest/runs", json={},
                            headers={HEADER_CLAVE_INGESTA: clave})

    assert_prohibido(response)
    assert off_falso.llamadas == []


@pytest.mark.parametrize("configurada", [None, SecretStr("")])
@pytest.mark.parametrize("enviada", [None, "", CLAVE_INGESTA])
def test_sin_clave_configurada_siempre_403(anonimo, off_falso, monkeypatch,
                                           configurada, enviada):
    monkeypatch.setattr(config.settings, "ingesta_clave", configurada)
    headers = {} if enviada is None else {HEADER_CLAVE_INGESTA: enviada}

    assert_prohibido(anonimo.post("/ingest/runs", json={}, headers=headers))
    assert off_falso.llamadas == []


def test_la_clave_se_revisa_antes_que_el_cuerpo(anonimo):
    # Sin clave no se puede sondear el esquema: 403, no 422.
    response = anonimo.post("/ingest/runs", json={"max_productos": "mucho"})

    assert_prohibido(response)


def test_con_la_clave_correcta_inicia_la_ingesta(anonimo, off_falso):
    off_falso.paginas = [{"products": [LECHE]}, {"products": []}]

    response = anonimo.post("/ingest/runs", json={},
                            headers={HEADER_CLAVE_INGESTA: CLAVE_INGESTA})

    assert response.status_code == 202
    assert anonimo.get("/ingest/runs/latest").json()["validos"] == 1


def test_compara_en_tiempo_constante(anonimo, monkeypatch):
    llamadas = []
    original = clave_ingesta.hmac.compare_digest

    def espia(a, b):
        llamadas.append((a, b))
        return original(a, b)

    monkeypatch.setattr(clave_ingesta.hmac, "compare_digest", espia)
    anonimo.post("/ingest/runs", json={},
                 headers={HEADER_CLAVE_INGESTA: "otra-clave"})

    assert len(llamadas) == 1
    # Compara resúmenes de igual largo, nunca la clave en texto plano.
    recibida, esperada = llamadas[0]
    assert len(recibida) == len(esperada) == 32
    assert CLAVE_INGESTA.encode() not in (recibida, esperada)


def test_el_rechazo_no_registra_la_clave(anonimo, caplog):
    anonimo.post("/ingest/runs", json={},
                 headers={HEADER_CLAVE_INGESTA: "clave-filtrada"})

    assert "rechazado" in caplog.text
    assert "clave-filtrada" not in caplog.text
    assert CLAVE_INGESTA not in caplog.text


@pytest.mark.parametrize("ruta", ["/ingest/runs/latest", "/search?q=leche",
                                  "/health", "/metrics/quality",
                                  "/metrics/evaluation"])
def test_los_demas_endpoints_siguen_publicos(anonimo, ruta):
    assert anonimo.get(ruta).status_code != 403


def test_openapi_documenta_el_header_y_el_403(client):
    post = client.get("/openapi.json").json()["paths"]["/ingest/runs"]["post"]

    assert "403" in post["responses"]
    header, = [p for p in post["parameters"]
               if p["name"] == HEADER_CLAVE_INGESTA]
    assert header["in"] == "header" and not header.get("required", False)


def test_la_clave_no_aparece_al_mostrar_la_configuracion():
    assert CLAVE_INGESTA not in repr(config.settings)
