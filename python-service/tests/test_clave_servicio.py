"""Clave compartida entre NestJS y FastAPI (X-Clave-Servicio): qué rutas
protege, cerrado por defecto, sin pistas, la transición y la comparación en
tiempo constante."""
import hmac
import logging

import pytest
from pydantic import SecretStr

from app.core import config
from app.core.clave_ingesta import HEADER_CLAVE_INGESTA
from app.core.clave_servicio import HEADER_CLAVE_SERVICIO, MENSAJE_RECHAZO
from app.core.config import Settings
from tests.conftest import CLAVE_INGESTA, CLAVE_SERVICIO
from tests.payloads_off import LECHE
from tests.test_adaptativo_endpoints import guardar

PERFIL = {"perfil": {"alergias": ["lacteos"]}}
# (método, ruta, cuerpo) de cada endpoint que consume NestJS.
PROTEGIDAS = [
    ("GET", "/search?q=leche", None),
    ("GET", f"/products/{LECHE['code']}", None),
    ("GET", "/metrics/quality", None),
    ("GET", "/metrics/evaluation", None),
    ("GET", "/ingest/runs/latest", None),
    ("POST", "/analizar", {"nombre": "Galletas", "ingredientes": ["harina"]}),
    ("POST", f"/products/{LECHE['code']}/compatibility", PERFIL),
    ("POST", "/search/personalized",
     {"consulta": "leche", "perfil": {"alergias": ["lacteos"]}}),
    ("GET", "/metrics/evaluation/adaptive", None),
]
IDS = [f"{metodo} {ruta.split('?')[0]}" for metodo, ruta, _ in PROTEGIDAS]


@pytest.fixture
def anonimo(client):
    """El mismo cliente, sin la clave de servicio que `client` envía."""
    del client.headers[HEADER_CLAVE_SERVICIO]
    return client


def pedir(cliente, metodo, ruta, cuerpo, **headers):
    return cliente.request(metodo, ruta, json=cuerpo, headers=headers)


def assert_prohibido(response):
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["codigo"] == "FORBIDDEN"
    # Mismo mensaje en todos los casos: no revela si hay clave configurada.
    assert error["mensaje"] == MENSAJE_RECHAZO
    assert error["request_id"]


@pytest.fixture
def transicion(monkeypatch):
    monkeypatch.setattr(config.settings, "clave_servicio_obligatoria", False)


# --- obligatoria (el valor por defecto) ------------------------------------

@pytest.mark.parametrize("metodo, ruta, cuerpo", PROTEGIDAS, ids=IDS)
def test_sin_clave_responde_403(anonimo, metodo, ruta, cuerpo):
    assert_prohibido(pedir(anonimo, metodo, ruta, cuerpo))


@pytest.mark.parametrize("metodo, ruta, cuerpo", PROTEGIDAS, ids=IDS)
def test_con_la_clave_correcta_responde(anonimo, repositorio, metodo, ruta,
                                        cuerpo):
    guardar(repositorio, LECHE)

    response = pedir(anonimo, metodo, ruta, cuerpo,
                     **{HEADER_CLAVE_SERVICIO: CLAVE_SERVICIO})

    # 404 solo en /ingest/runs/latest, que todavía no tiene ingestas.
    assert response.status_code in (200, 404), response.text
    assert response.status_code != 403


@pytest.mark.parametrize("clave", ["otra-clave", CLAVE_SERVICIO + "x",
                                   CLAVE_SERVICIO.upper(), CLAVE_INGESTA,
                                   " " + CLAVE_SERVICIO])
def test_clave_incorrecta_responde_403(anonimo, clave):
    assert_prohibido(anonimo.get("/metrics/quality",
                                 headers={HEADER_CLAVE_SERVICIO: clave}))


@pytest.mark.parametrize("configurada", [None, SecretStr("")])
@pytest.mark.parametrize("enviada", [None, "", CLAVE_SERVICIO])
def test_sin_clave_configurada_siempre_403(anonimo, monkeypatch, configurada,
                                           enviada):
    monkeypatch.setattr(config.settings, "clave_servicio", configurada)
    headers = {} if enviada is None else {HEADER_CLAVE_SERVICIO: enviada}

    assert_prohibido(anonimo.get("/metrics/quality", headers=headers))


@pytest.mark.parametrize("ruta", ["/health", "/", "/openapi.json", "/docs"])
def test_rutas_publicas_no_piden_clave(anonimo, ruta):
    assert anonimo.get(ruta).status_code == 200


def test_post_ingest_runs_solo_exige_su_propia_clave(anonimo, off_falso):
    off_falso.paginas = [{"products": []}]

    response = anonimo.post("/ingest/runs", json={},
                            headers={HEADER_CLAVE_INGESTA: CLAVE_INGESTA})

    assert response.status_code == 202


def test_la_clave_se_revisa_antes_que_el_cuerpo(anonimo):
    # Sin clave no se puede sondear el esquema: 403, no 422.
    response = anonimo.post("/search/personalized",
                            json={"consulta": "x", "perfil": {"a": 1}})

    assert_prohibido(response)


def test_el_rechazo_queda_en_el_log_sin_la_clave(anonimo, caplog):
    with caplog.at_level(logging.WARNING, logger="app.core.clave_servicio"):
        anonimo.get("/metrics/quality",
                    headers={HEADER_CLAVE_SERVICIO: "clave-equivocada"})

    registro = next(r for r in caplog.records
                    if getattr(r, "evento", "") == "clave_servicio_rechazada")
    assert registro.ruta == "/metrics/quality"
    assert "clave-equivocada" not in caplog.text


def test_compara_en_tiempo_constante(anonimo, monkeypatch):
    llamadas = []
    original = hmac.compare_digest

    def espia(a, b):
        llamadas.append((a, b))
        return original(a, b)

    monkeypatch.setattr(hmac, "compare_digest", espia)

    anonimo.get("/metrics/quality",
                headers={HEADER_CLAVE_SERVICIO: CLAVE_SERVICIO})
    anonimo.get("/metrics/quality",
                headers={HEADER_CLAVE_SERVICIO: "otra"})

    assert len(llamadas) == 2
    # Compara hashes del mismo largo, no las claves: tampoco filtra el largo.
    assert all(len(a) == len(b) == 32 for a, b in llamadas)


# --- transición (CLAVE_SERVICIO_OBLIGATORIA=false) -------------------------

@pytest.mark.parametrize("metodo, ruta, cuerpo", PROTEGIDAS, ids=IDS)
def test_transicion_acepta_sin_clave(anonimo, transicion, metodo, ruta,
                                     cuerpo):
    response = pedir(anonimo, metodo, ruta, cuerpo)

    assert response.status_code != 403


def test_transicion_avisa_en_el_log(anonimo, transicion, caplog):
    with caplog.at_level(logging.WARNING, logger="app.core.clave_servicio"):
        assert anonimo.get("/metrics/quality").status_code == 200

    registro = next(r for r in caplog.records
                    if getattr(r, "evento", "") == "clave_servicio_ausente")
    assert registro.ruta == "/metrics/quality"


def test_transicion_trata_el_header_vacio_como_ausente(anonimo, transicion):
    response = anonimo.get("/metrics/quality",
                           headers={HEADER_CLAVE_SERVICIO: ""})

    assert response.status_code == 200


def test_transicion_rechaza_una_clave_incorrecta(anonimo, transicion):
    assert_prohibido(anonimo.get("/metrics/quality",
                                 headers={HEADER_CLAVE_SERVICIO: "otra"}))


def test_transicion_acepta_la_clave_correcta(anonimo, transicion):
    response = anonimo.get("/metrics/quality",
                           headers={HEADER_CLAVE_SERVICIO: CLAVE_SERVICIO})

    assert response.status_code == 200


def test_transicion_sin_clave_configurada_rechaza_si_mandan_una(
    anonimo, transicion, monkeypatch
):
    monkeypatch.setattr(config.settings, "clave_servicio", None)

    assert anonimo.get("/metrics/quality").status_code == 200
    assert_prohibido(anonimo.get(
        "/metrics/quality", headers={HEADER_CLAVE_SERVICIO: CLAVE_SERVICIO}))


# --- configuración y contrato ----------------------------------------------

def test_obligatoria_por_defecto(monkeypatch):
    monkeypatch.delenv("CLAVE_SERVICIO_OBLIGATORIA", raising=False)
    assert Settings().clave_servicio_obligatoria is True


@pytest.mark.parametrize("valor, esperado", [("false", False), ("0", False),
                                             ("true", True)])
def test_obligatoria_se_lee_del_entorno(monkeypatch, valor, esperado):
    monkeypatch.setenv("CLAVE_SERVICIO_OBLIGATORIA", valor)
    assert Settings().clave_servicio_obligatoria is esperado


def test_la_clave_no_aparece_en_la_configuracion(monkeypatch):
    monkeypatch.setenv("CLAVE_SERVICIO", "secreta")
    configuracion = Settings()
    assert configuracion.clave_servicio.get_secret_value() == "secreta"
    assert "secreta" not in repr(configuracion)


def test_el_contrato_documenta_el_header_y_el_403(client):
    rutas = client.get("/openapi.json").json()["paths"]

    for metodo, ruta, _ in PROTEGIDAS:
        plantilla = (ruta.split("?")[0]
                     .replace(LECHE["code"], "{codigo_barras}"))
        operacion = rutas[plantilla][metodo.lower()]
        headers = {p["name"] for p in operacion.get("parameters", [])
                   if p["in"] == "header"}
        assert HEADER_CLAVE_SERVICIO in headers, plantilla
        assert "403" in operacion["responses"], plantilla
    salud = rutas["/health"]["get"]
    assert HEADER_CLAVE_SERVICIO not in {
        p["name"] for p in salud.get("parameters", [])}
