from app.schemas.metricas import MetricasEvaluacion


def test_metricas_evaluacion_siguen_siendo_stub(client):
    response = client.get("/metrics/evaluation")
    assert response.status_code == 200
    assert response.headers["X-Stub"] == "true"
    assert MetricasEvaluacion.model_validate(response.json()).k == 5
