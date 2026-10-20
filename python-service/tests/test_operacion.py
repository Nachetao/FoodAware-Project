import uuid

import pytest

from app.schemas.ingesta import ResumenIngesta
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.services.catalogo_stub import cargar_productos


def test_iniciar_ingesta(client):
    response = client.post("/ingest/runs", json={"max_productos": 50})
    assert response.status_code == 202
    assert response.headers["X-Stub"] == "true"
    resumen = ResumenIngesta.model_validate(response.json())
    assert resumen.estado == "en_curso"
    assert resumen.fin is None
    assert uuid.UUID(str(resumen.run_id)).version == 4


def test_iniciar_ingesta_acepta_valores_por_defecto(client):
    assert client.post("/ingest/runs", json={}).status_code == 202


@pytest.mark.parametrize(
    "cuerpo",
    [{"max_productos": 0}, {"max_productos": 501}, {"otro": 1}, None],
)
def test_iniciar_ingesta_invalida(client, cuerpo):
    response = client.post("/ingest/runs", json=cuerpo)
    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


def test_ultima_ingesta_es_trazable_a_los_productos(client):
    response = client.get("/ingest/runs/latest")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    resumen = ResumenIngesta.model_validate(response.json())
    productos = cargar_productos()
    assert {p.procedencia.run_id for p in productos} == {resumen.run_id}
    assert resumen.validos - resumen.duplicados == len(productos)


def test_metricas_calidad(client):
    response = client.get("/metrics/quality")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    metricas = MetricasCalidad.model_validate(response.json())
    assert metricas.total_productos == len(cargar_productos())


def test_metricas_evaluacion(client):
    response = client.get("/metrics/evaluation")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    assert MetricasEvaluacion.model_validate(response.json()).k == 5


def test_openapi_documenta_ingesta(client):
    rutas = client.get("/openapi.json").json()["paths"]
    respuestas = rutas["/ingest/runs"]["post"]["responses"]
    assert set(respuestas) == {"202", "422", "500", "503"}
    assert "404" in rutas["/ingest/runs/latest"]["get"]["responses"]
