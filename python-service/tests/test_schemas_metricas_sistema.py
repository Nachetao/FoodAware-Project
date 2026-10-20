import pytest
from pydantic import ValidationError

from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion
from app.schemas.sistema import RespuestaError, RespuestaSalud

REQUEST_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b"


def test_metricas_validas():
    MetricasCalidad(porcentaje_validos=100, porcentaje_duplicados=0,
                    cobertura_ingredientes=87.5,
                    antiguedad_promedio_horas=0, total_productos=0)
    MetricasEvaluacion(k=5, precision_at_k=1, recall_at_k=0,
                       consultas_evaluadas=20, tiempo_promedio_ms=14.3)


@pytest.mark.parametrize("campo", ["porcentaje_validos",
                                   "cobertura_ingredientes"])
def test_porcentaje_fuera_de_rango(campo):
    datos = {"porcentaje_validos": 90, "porcentaje_duplicados": 5,
             "cobertura_ingredientes": 80, "antiguedad_promedio_horas": 1,
             "total_productos": 10, campo: 100.1}
    with pytest.raises(ValidationError):
        MetricasCalidad.model_validate(datos)


@pytest.mark.parametrize(
    "cambios", [{"k": 0}, {"k": 51}, {"precision_at_k": 1.2},
                {"recall_at_k": -0.1}]
)
def test_metricas_evaluacion_invalidas(cambios):
    datos = {"k": 5, "precision_at_k": 0.8, "recall_at_k": 0.6,
             "consultas_evaluadas": 20, "tiempo_promedio_ms": 10}
    with pytest.raises(ValidationError):
        MetricasEvaluacion.model_validate({**datos, **cambios})


def test_salud_valida():
    salud = RespuestaSalud(estado="ok", servicio="foodaware-ia",
                           version="1.0.0",
                           verificado_en="2026-10-20T14:30:00Z",
                           dependencias={"openfoodfacts": "no_verificado"})
    assert salud.dependencias["openfoodfacts"] == "no_verificado"


def test_salud_invalida():
    with pytest.raises(ValidationError):
        RespuestaSalud(estado="ok", servicio="foodaware-ia", version="1",
                       verificado_en="2026-10-20T14:30:00Z",
                       dependencias={"openfoodfacts": "caido"})


def test_error_tiene_forma_del_contrato():
    error = RespuestaError(error={"codigo": "NOT_FOUND",
                                  "mensaje": "Producto no encontrado",
                                  "request_id": REQUEST_ID})
    assert error.model_dump(mode="json") == {
        "error": {"codigo": "NOT_FOUND",
                  "mensaje": "Producto no encontrado",
                  "request_id": REQUEST_ID}
    }


@pytest.mark.parametrize(
    "detalle",
    [
        {"codigo": "TEAPOT", "mensaje": "x", "request_id": "r"},
        {"codigo": "NOT_FOUND", "mensaje": "", "request_id": "r"},
        {"codigo": "NOT_FOUND", "mensaje": "x", "request_id": ""},
        {"codigo": "NOT_FOUND", "mensaje": "x"},
    ],
)
def test_error_invalido(detalle):
    with pytest.raises(ValidationError):
        RespuestaError(error=detalle)
