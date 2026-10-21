from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion


def test_metricas_calidad_siguen_siendo_stub(client):
    response = client.get("/metrics/quality")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    MetricasCalidad.model_validate(response.json())


def test_metricas_evaluacion_siguen_siendo_stub(client):
    response = client.get("/metrics/evaluation")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    assert MetricasEvaluacion.model_validate(response.json()).k == 5
