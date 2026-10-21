import uuid
from datetime import datetime, timezone

import pytest

from app.procesamiento.calidad import (
    clave_duplicado,
    con_duplicados,
    digito_verificador_valido,
    evaluar_calidad,
    marcar_duplicados,
    problemas_codigo_barras,
)
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import LECHE

AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def mapear(payload):
    return mapear_producto(payload, run_id=uuid.uuid4(), recuperado_en=AHORA,
                           base_url="https://world.openfoodfacts.org")


def calidad(**cambios):
    campos = dict(
        codigo_barras="7802920000015", nombre="Leche entera",
        marca="Colun", cantidad="1 L",
        ingredientes_texto="Leche entera.", ingredientes=["leche entera"],
        nutriscore="b", imagen_url="https://example.org/leche.jpg",
    )
    campos.update(cambios)
    return evaluar_calidad(**campos)


@pytest.mark.parametrize(
    "codigo",
    [
        "96385074",       # EAN-8
        "036000291452",   # UPC-A
        "4006381333931",  # EAN-13
        "7802920000015",  # EAN-13 chileno (780)
        "0036000291452",  # UPC-A con el cero de EAN-13
    ],
)
def test_digito_verificador_valido(codigo):
    assert digito_verificador_valido(codigo)
    assert problemas_codigo_barras(codigo) == []


@pytest.mark.parametrize(
    "codigo",
    ["96385075", "036000291453", "4006381333930", "7802920000016"],
)
def test_digito_verificador_invalido(codigo):
    assert not digito_verificador_valido(codigo)
    assert problemas_codigo_barras(codigo) == [
        "codigo_barras_digito_verificador_invalido"
    ]


@pytest.mark.parametrize(
    "codigo", ["123456789", "1234567890", "12345678901", "12345678901231"]
)
def test_longitudes_no_soportadas(codigo):
    assert not digito_verificador_valido(codigo)
    assert problemas_codigo_barras(codigo) == [
        "codigo_barras_longitud_invalida"
    ]


def test_producto_completo_es_valido():
    resultado = calidad()
    assert resultado.es_valido is True
    assert resultado.problemas == []
    assert resultado.completitud == 1.0


@pytest.mark.parametrize(
    "cambios, problema",
    [
        ({"nombre": None}, "sin_nombre"),
        ({"ingredientes_texto": None, "ingredientes": []},
         "sin_ingredientes"),
        ({"ingredientes_texto": "Ingredientes: .", "ingredientes": []},
         "ingredientes_vacios"),
        ({"codigo_barras": "7802920000016"},
         "codigo_barras_digito_verificador_invalido"),
        ({"codigo_barras": "1234567890"}, "codigo_barras_longitud_invalida"),
    ],
)
def test_cada_regla_de_validez(cambios, problema):
    resultado = calidad(**cambios)
    assert resultado.es_valido is False
    assert problema in resultado.problemas


@pytest.mark.parametrize(
    "cambios, problema",
    [
        ({"marca": None}, "sin_marca"),
        ({"cantidad": None}, "sin_cantidad"),
        ({"nutriscore": None}, "sin_nutriscore"),
        ({"imagen_url": None}, "sin_imagen"),
        ({"otros_problemas": ["alergeno_detectado_en_texto:lacteos"]},
         "alergeno_detectado_en_texto:lacteos"),
    ],
)
def test_problemas_informativos_no_invalidan(cambios, problema):
    resultado = calidad(**cambios)
    assert resultado.es_valido is True
    assert problema in resultado.problemas


def test_completitud_cuenta_ingredientes_limpios():
    assert calidad(marca=None, imagen_url=None).completitud == 0.67
    # Texto presente pero sin ingredientes tras limpiar: no cuenta.
    vacios = calidad(ingredientes_texto="*", ingredientes=[])
    assert vacios.completitud == 0.83
    nada = calidad(nombre=None, marca=None, cantidad=None,
                   ingredientes_texto=None, ingredientes=[], nutriscore=None,
                   imagen_url=None)
    assert nada.completitud == 0.0


def test_clave_duplicado_normaliza():
    a = mapear(LECHE)
    b = mapear({**LECHE, "code": "7801234000018",
                "product_name_es": "LECHE  ENTERA",
                "brands": "lacteos del sur", "quantity": "1L"})
    assert clave_duplicado(a) == clave_duplicado(b) is not None


@pytest.mark.parametrize(
    "cambios", [{"brands": None}, {"quantity": None},
                {"product_name_es": None, "product_name": None}],
)
def test_sin_clave_si_falta_un_dato(cambios):
    assert clave_duplicado(mapear({**LECHE, **cambios})) is None


def test_marcar_duplicados_no_descarta():
    leche = mapear(LECHE)
    gemela = mapear({**LECHE, "code": "7801234000018"})
    otra_marca = mapear({**LECHE, "code": "7805678000023",
                         "brands": "Otra marca"})
    otra_cantidad = mapear({**LECHE, "code": "7809012000038",
                            "quantity": "200 ml"})
    marcados = marcar_duplicados([leche, gemela, otra_marca, otra_cantidad])
    assert len(marcados) == 4
    assert marcados[0].calidad.problemas == [
        "posible_duplicado:7801234000018"
    ]
    assert marcados[1].calidad.problemas == [
        "posible_duplicado:7802920000015"
    ]
    assert marcados[2].calidad.problemas == []
    assert marcados[3].calidad.problemas == []
    assert all(p.calidad.es_valido for p in marcados)


def test_con_duplicados_es_idempotente():
    leche = mapear(LECHE)
    una_vez = con_duplicados(leche, ["7801234000018"])
    dos_veces = con_duplicados(una_vez, ["7801234000018", "7802920000015"])
    assert dos_veces.calidad.problemas == ["posible_duplicado:7801234000018"]
    assert con_duplicados(dos_veces, []).calidad.problemas == []
