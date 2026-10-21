import copy
import uuid
from datetime import datetime, timezone

import pytest

from app.schemas.producto import Producto
from app.services.mapeo_off import (
    ALERGENOS_OFF,
    ProductoInvalido,
    mapear_producto,
)
from tests.payloads_off import GALLETAS, INCOMPLETO, LECHE

RUN_ID = uuid.UUID("3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b")
AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
BASE = "https://world.openfoodfacts.org"


def mapear(payload, run_id=RUN_ID, recuperado_en=AHORA):
    return mapear_producto(
        payload, run_id=run_id, recuperado_en=recuperado_en, base_url=BASE
    )


def test_mapea_producto_completo():
    producto = mapear(LECHE)
    datos = producto.model_dump(mode="json")
    assert datos["codigo_barras"] == "7802920000015"
    assert datos["nombre"] == "Leche entera"
    assert datos["marca"] == "Lácteos del Sur"
    assert datos["ingredientes_texto"] == (
        "_Leche_ entera, vitamina A, vitamina D3."
    )
    assert datos["ingredientes"] == [
        "leche entera", "vitamina a", "vitamina d3"
    ]
    assert datos["alergenos"] == ["lacteos"]
    assert datos["etiquetas_dieta"] == ["vegetariano", "sin_gluten"]
    assert datos["nutriscore"] == "b"
    assert datos["imagen_url"].endswith("front_es.3.400.jpg")
    assert datos["calidad"] == {
        "es_valido": True, "problemas": [], "completitud": 1.0
    }
    procedencia = datos["procedencia"]
    assert procedencia["url_fuente"] == f"{BASE}/product/7802920000015"
    assert procedencia["recuperado_en"] == "2026-10-21T12:00:00Z"
    assert procedencia["modificado_en_fuente"] == "2025-09-04T15:33:20Z"
    assert procedencia["run_id"] == str(RUN_ID)
    # Cumple el contrato completo
    Producto.model_validate(datos)


def test_mapea_alergenos_trazas_y_calidad():
    producto = mapear(GALLETAS)
    assert [a.value for a in producto.alergenos] == [
        "gluten", "lacteos", "huevo", "soya"
    ]
    assert [t.value for t in producto.trazas] == ["frutos_secos"]
    assert producto.nutriscore is None
    assert str(producto.imagen_url).endswith("front_es.5.400.jpg")
    assert producto.calidad.es_valido is True
    # "es:avellanas" ya se resuelve y todo lo del texto venía en OFF.
    assert producto.calidad.problemas == ["sin_nutriscore"]
    assert producto.calidad.completitud == 0.83


def test_producto_incompleto_es_invalido():
    producto = mapear(INCOMPLETO)
    assert producto.nombre == "Producto 7801111000011"
    assert producto.calidad.es_valido is False
    assert producto.calidad.problemas == [
        "sin_nombre", "sin_marca", "sin_cantidad", "sin_ingredientes",
        "sin_nutriscore", "sin_imagen",
    ]
    assert producto.calidad.completitud == 0.0
    assert producto.ingredientes == []
    assert producto.procedencia.modificado_en_fuente is None


@pytest.mark.parametrize("etiqueta, codigo", sorted(ALERGENOS_OFF.items()))
def test_los_14_alergenos(etiqueta, codigo):
    payload = {**LECHE, "ingredients_text_es": "Agua, sal.",
               "allergens_tags": [etiqueta], "traces_tags": [etiqueta]}
    producto = mapear(payload)
    assert producto.alergenos == [codigo]
    assert producto.trazas == [codigo]


def test_union_de_etiquetas_y_texto_con_trazabilidad():
    payload = {
        **LECHE,
        "ingredients_text_es": (
            "Harina de trigo, azúcar, mantequilla, huevo, sal. Puede "
            "contener trazas de maní y sésamo."
        ),
        "allergens_tags": ["en:gluten"],
        "traces_tags": ["en:peanuts"],
    }
    producto = mapear(payload)
    assert [a.value for a in producto.alergenos] == [
        "gluten", "lacteos", "huevo"
    ]
    assert [t.value for t in producto.trazas] == ["mani", "sesamo"]
    assert producto.calidad.problemas == [
        "alergeno_detectado_en_texto:lacteos",
        "alergeno_detectado_en_texto:huevo",
        "traza_detectada_en_texto:sesamo",
    ]


def test_detecta_en_texto_sin_etiquetas_de_off():
    payload = {**LECHE, "allergens_tags": [], "traces_tags": []}
    producto = mapear(payload)
    assert [a.value for a in producto.alergenos] == ["lacteos"]
    assert "alergeno_detectado_en_texto:lacteos" in producto.calidad.problemas


@pytest.mark.parametrize(
    "etiqueta, esperado",
    [
        ("es:avellanas", ["frutos_secos"]),
        ("es:leche", ["lacteos"]),
        ("es:trazas-de-frutos-secos", ["frutos_secos"]),
        ("es:crustaceos", ["crustaceos"]),
        ("es:mariscos", ["crustaceos", "moluscos"]),
        ("es:sulfitos", ["sulfitos"]),
    ],
)
def test_resuelve_etiquetas_fuera_de_la_taxonomia(etiqueta, esperado):
    payload = {**LECHE, "ingredients_text_es": "Agua.",
               "allergens_tags": [etiqueta], "traces_tags": []}
    producto = mapear(payload)
    assert [a.value for a in producto.alergenos] == esperado
    assert "alergenos_no_reconocidos" not in producto.calidad.problemas


def test_etiqueta_irreconocible_queda_registrada():
    payload = {**LECHE, "ingredients_text_es": "Agua.",
               "allergens_tags": ["fr:lait", "en:none"]}
    producto = mapear(payload)
    assert producto.alergenos == []
    assert "alergenos_no_reconocidos" in producto.calidad.problemas


def test_tabla_cubre_todos_los_codigos_del_contrato():
    from app.schemas.enums import AllergenCode
    assert set(ALERGENOS_OFF.values()) == set(AllergenCode)


def test_vegano_implica_vegetariano():
    producto = mapear({**LECHE, "labels_tags": ["en:vegan", "en:no-lactose"]})
    assert [e.value for e in producto.etiquetas_dieta] == [
        "vegano", "sin_lactosa", "vegetariano"
    ]


def test_prioriza_textos_en_espanol():
    payload = {**LECHE, "product_name": "Whole milk"}
    producto = mapear(payload)
    assert producto.nombre == "Leche entera"
    sin_es = {k: v for k, v in LECHE.items() if not k.endswith("_es")}
    producto = mapear(sin_es)
    assert producto.ingredientes_texto == "Whole milk, vitamin A, vitamin D3"


@pytest.mark.parametrize(
    "codigo", ["", None, "123", "abc4567890123", "1" * 15]
)
def test_codigo_invalido(codigo):
    with pytest.raises(ProductoInvalido):
        mapear({**LECHE, "code": codigo})


def test_hash_depende_solo_del_contenido():
    original = mapear(LECHE).procedencia.hash_contenido
    otro_run = mapear(LECHE, run_id=uuid.uuid4(),
                      recuperado_en=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert otro_run.procedencia.hash_contenido == original
    cambiado = copy.deepcopy(LECHE)
    cambiado["ingredients_text_es"] = "Leche entera, vitamina D3."
    assert mapear(cambiado).procedencia.hash_contenido != original


@pytest.mark.parametrize(
    "cambios, campo, esperado",
    [
        ({"nutriscore_grade": "C"}, "nutriscore", "c"),
        ({"image_front_url": "no-es-url", "image_url": None},
         "imagen_url", None),
        ({"quantity": "x" * 80}, "cantidad", "x" * 50),
        ({"product_name_es": "  Leche   entera  "}, "nombre", "Leche entera"),
        ({"last_modified_t": "ayer"}, None, None),
    ],
)
def test_normaliza_campos(cambios, campo, esperado):
    producto = mapear({**LECHE, **cambios})
    if campo:
        assert getattr(producto, campo) == esperado
    else:
        assert producto.procedencia.modificado_en_fuente is None


def test_lista_de_ingredientes_limpia():
    producto = mapear(GALLETAS)
    assert producto.ingredientes_texto == GALLETAS["ingredients_text"]
    assert producto.ingredientes == [
        "harina de trigo enriquecida (harina de trigo, hierro, tiamina)",
        "azúcar", "aceite vegetal", "suero de leche en polvo", "huevo",
        "emulsionante (lecitina de soya)", "sal",
    ]
