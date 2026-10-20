from datetime import timezone

import pytest
from pydantic import ValidationError

from app.schemas.enums import AllergenCode
from app.schemas.producto import Calidad, Procedencia, Producto


def procedencia_valida(**cambios):
    datos = {
        "url_fuente": "https://world.openfoodfacts.org/product/7802800716999",
        "recuperado_en": "2026-10-20T14:30:00Z",
        "run_id": "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
        "hash_contenido": "a" * 64,
    }
    datos.update(cambios)
    return datos


def producto_valido(**cambios):
    datos = {
        "codigo_barras": "7802800716999",
        "nombre": "Leche semidescremada",
        "alergenos": ["lacteos"],
        "etiquetas_dieta": ["vegetariano"],
        "nutriscore": "b",
        "procedencia": procedencia_valida(),
        "calidad": {"es_valido": True, "completitud": 0.85},
    }
    datos.update(cambios)
    return datos


def test_producto_valido_serializa_a_json():
    producto = Producto.model_validate(producto_valido())
    datos = producto.model_dump(mode="json")
    assert datos["alergenos"] == ["lacteos"]
    assert datos["procedencia"]["fuente"] == "openfoodfacts"
    assert datos["procedencia"]["recuperado_en"] == "2026-10-20T14:30:00Z"
    assert datos["marca"] is None
    assert datos["trazas"] == []
    assert datos["calidad"]["problemas"] == []


def test_alergenos_se_convierten_a_enum():
    producto = Producto.model_validate(producto_valido())
    assert producto.alergenos == [AllergenCode.lacteos]


def test_nombre_se_limpia_de_espacios():
    producto = Producto.model_validate(producto_valido(nombre="  Yogur  "))
    assert producto.nombre == "Yogur"


@pytest.mark.parametrize("codigo", ["12345678", "12345678901234"])
def test_codigo_barras_en_rango(codigo):
    Producto.model_validate(producto_valido(codigo_barras=codigo))


@pytest.mark.parametrize(
    "cambios",
    [
        {"codigo_barras": "1234567"},
        {"codigo_barras": "123456789012345"},
        {"codigo_barras": "78028007169AB"},
        {"nombre": "   "},
        {"alergenos": ["maní"]},
        {"trazas": ["lácteos"]},
        {"etiquetas_dieta": ["keto"]},
        {"nutriscore": "f"},
        {"nutriscore": "B"},
        {"imagen_url": "no-es-url"},
        {"procedencia": None},
    ],
)
def test_producto_invalido(cambios):
    with pytest.raises(ValidationError):
        Producto.model_validate(producto_valido(**cambios))


def test_recuperado_en_se_normaliza_a_utc():
    procedencia = Procedencia.model_validate(
        procedencia_valida(recuperado_en="2026-10-20T11:30:00-03:00")
    )
    assert procedencia.recuperado_en.tzinfo == timezone.utc
    assert procedencia.recuperado_en.hour == 14


@pytest.mark.parametrize(
    "cambios",
    [
        {"fuente": "otra_fuente"},
        {"url_fuente": "ftp://ejemplo"},
        {"recuperado_en": "2026-10-20T14:30:00"},
        {"modificado_en_fuente": "2026-09-02T08:15:00"},
        {"run_id": "no-es-uuid"},
        {"hash_contenido": "a" * 63},
        {"hash_contenido": "A" * 64},
    ],
)
def test_procedencia_invalida(cambios):
    with pytest.raises(ValidationError):
        Procedencia.model_validate(procedencia_valida(**cambios))


@pytest.mark.parametrize("completitud", [0, 0.5, 1])
def test_completitud_valida(completitud):
    Calidad(es_valido=True, completitud=completitud)


@pytest.mark.parametrize("completitud", [-0.1, 1.01])
def test_completitud_fuera_de_rango(completitud):
    with pytest.raises(ValidationError):
        Calidad(es_valido=False, completitud=completitud)
