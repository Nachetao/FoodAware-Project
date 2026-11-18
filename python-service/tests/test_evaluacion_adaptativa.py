"""Evaluación de la capacidad adaptativa: veredictos contra el etiquetado,
detección y búsqueda base contra personalizada, con casos calculables a
mano."""
import uuid
from datetime import datetime, timezone

import pytest

from app.busqueda.buscador import Instantanea
from app.evaluacion.adaptativa import (
    PERFILES_PRUEBA,
    evaluar_adaptativa,
    evita,
    veredicto_esperado,
)
from app.evaluacion.conjunto import conjunto_desde_dict
from app.evaluacion.etiquetado import ProductoEtiquetado
from app.schemas.adaptativo import PerfilRestricciones
from app.schemas.enums import AllergenCode as A
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import payload

pytestmark = pytest.mark.recuperacion

GALLETAS = ["en:biscuits"]
# El detector no conoce "tagatosa": si el etiquetado dice que hay lácteos,
# es un falso negativo de la detección y un falso apto del veredicto.
SIN_DETECTAR = payload(41, "Galletas de tagatosa", "Harina de arroz, tagatosa",
                       categories_tags=GALLETAS)
# El detector marca lácteos por la mantequilla, pero el etiquetado dice que
# no tiene (un falso positivo, armado para la prueba).
DE_MAS = payload(42, "Galletas de mantequilla", "Harina de arroz, mantequilla",
                 categories_tags=GALLETAS)
CON_LECHE = payload(43, "Galletas con leche", "Harina de arroz, leche",
                    categories_tags=GALLETAS)
CON_TRAZA = payload(44, "Galletas de coco",
                    "Harina de arroz, coco. Puede contener leche",
                    categories_tags=GALLETAS)
LIMPIA = payload(45, "Galletas de arroz", "Harina de arroz, sal",
                 categories_tags=GALLETAS)
CORPUS = [SIN_DETECTAR, DE_MAS, CON_LECHE, CON_TRAZA, LIMPIA]

CONJUNTO = conjunto_desde_dict({"version": 1, "consultas": [
    {"id": "galletas-sin-leche", "consulta": "galletas sin leche",
     "tipo": "restriccion",
     "relevancia": {"categorias_alguna": GALLETAS,
                    "sin_alergenos": ["lacteos"]}},
    # Las de producto no entran en esta evaluación.
    {"id": "galletas", "consulta": "galletas", "tipo": "producto",
     "relevancia": {"categorias_alguna": GALLETAS}},
]})
LACTEOS = (("alergia a lácteos", PerfilRestricciones(alergias=[A.lacteos])),)


def etiqueta(datos, alergenos, trazas, revisado=True):
    return ProductoEtiquetado(
        codigo_barras=datos["code"], nombre=datos["product_name_es"],
        alergenos=None if alergenos is None else frozenset(alergenos),
        trazas=None if trazas is None else frozenset(trazas),
        revisado=revisado,
    )


ETIQUETADO = [
    etiqueta(SIN_DETECTAR, [A.lacteos], []),
    etiqueta(DE_MAS, [], []),
    etiqueta(CON_LECHE, [A.lacteos], None),  # trazas sin decidir
    etiqueta(CON_TRAZA, [], [A.lacteos]),
    etiqueta(LIMPIA, None, []),  # alérgenos sin decidir
    # No revisado: no cuenta.
    etiqueta(payload(46, "x", "x"), [A.mani], [], revisado=False),
    # Revisado, pero no está en el índice.
    ProductoEtiquetado("7800000000999", "Fuera del índice",
                       frozenset(), frozenset(), True),
]


@pytest.fixture(scope="module")
def registros():
    return [
        (mapear_producto(p, run_id=uuid.uuid4(),
                         recuperado_en=datetime(2026, 11, 18,
                                                tzinfo=timezone.utc),
                         base_url="https://world.openfoodfacts.org"), p)
        for p in CORPUS
    ]


@pytest.fixture(scope="module")
def resultado(registros):
    return evaluar_adaptativa(ETIQUETADO, CONJUNTO, registros,
                              Instantanea.construir(registros), k=5,
                              perfiles=LACTEOS)


def perfil(resultado, modo):
    return next(p for p in resultado.perfiles if p.modo == modo)


# --- veredicto esperado ------------------------------------------------------

def test_evita_suma_las_dietas():
    assert evita(PerfilRestricciones(alergias=[A.mani], dietas=["vegano"])) \
        >= {A.mani, A.lacteos, A.huevo, A.pescado}


@pytest.mark.parametrize("alergenos, trazas, estricto, esperado", [
    ([A.lacteos], [], False, "no_apto"),
    ([A.lacteos], None, False, "no_apto"),  # contiene: basta saber eso
    ([], [A.lacteos], False, "apto_con_advertencia"),
    ([], [A.lacteos], True, "no_apto"),
    ([], [], False, "apto"),
    ([A.mani], [A.soya], True, "apto"),  # nada que el perfil evite
    (None, [], False, None),
    ([], None, False, None),
])
def test_veredicto_esperado(alergenos, trazas, estricto, esperado):
    perfil_ = PerfilRestricciones(alergias=[A.lacteos],
                                  modo_estricto=estricto)
    assert veredicto_esperado(etiqueta(LIMPIA, alergenos, trazas),
                              perfil_) == esperado


# --- etiquetado --------------------------------------------------------------

def test_solo_cuentan_los_revisados_y_se_informan_los_que_faltan(resultado):
    assert resultado.revisados == 6
    assert resultado.no_encontrados == ("7800000000999",)
    assert resultado.evaluados == 5


# --- veredictos --------------------------------------------------------------

def test_falso_apto_contra_el_etiquetado(resultado):
    normal = perfil(resultado, "normal")

    # Solo SIN_DETECTAR: contiene lácteos según el etiquetado y el sistema
    # no los ve. LIMPIA no cuenta (alérgenos en null).
    assert normal.productos == 4
    assert normal.contienen == 2
    assert normal.falsos_apto == (SIN_DETECTAR["code"],)
    assert normal.tasa_falsos_apto == 0.5


def test_falso_no_apto_contra_el_etiquetado(resultado):
    normal = perfil(resultado, "normal")

    assert normal.falsos_no_apto == (DE_MAS["code"],)
    # Esperado no es no_apto en DE_MAS (apto) y CON_TRAZA (advertencia).
    assert normal.no_deberian_ser_no_apto == 2
    assert normal.tasa_falsos_no_apto == 0.5


def test_matriz_deja_fuera_los_campos_en_null(resultado):
    normal = perfil(resultado, "normal")

    # CON_LECHE entra (contiene: esperado no_apto aunque sus trazas sean
    # null); LIMPIA no (alérgenos en null).
    assert normal.productos_completos == 4
    assert normal.matriz["no_apto"]["no_apto"] == 1  # CON_LECHE
    assert normal.matriz["no_apto"]["apto"] == 1  # SIN_DETECTAR
    assert normal.matriz["apto"]["no_apto"] == 1  # DE_MAS
    assert normal.matriz["apto_con_advertencia"][
        "apto_con_advertencia"] == 1  # CON_TRAZA
    assert normal.coincidencias == 2
    assert sum(sum(fila.values()) for fila in normal.matriz.values()) == 4


def test_en_estricto_la_traza_se_espera_no_apto(resultado):
    estricto = perfil(resultado, "estricto")

    assert estricto.matriz["no_apto"]["no_apto"] == 2  # CON_LECHE, CON_TRAZA
    assert estricto.no_deberian_ser_no_apto == 1  # solo DE_MAS


def test_falso_apto_por_traza(registros):
    # El etiquetado dice que LIMPIA puede contener lácteos; el sistema no lo
    # sabe y la marca apta.
    resultado = evaluar_adaptativa(
        [etiqueta(LIMPIA, [], [A.lacteos])], CONJUNTO, registros,
        Instantanea.construir(registros), perfiles=LACTEOS)

    normal = perfil(resultado, "normal")
    assert normal.falsos_apto == ()
    assert normal.falsos_apto_por_traza == (LIMPIA["code"],)


def test_perfiles_de_prueba_en_los_dos_modos(registros):
    resultado = evaluar_adaptativa(ETIQUETADO, CONJUNTO, registros,
                                   Instantanea.construir(registros))

    assert len(resultado.perfiles) == 2 * len(PERFILES_PRUEBA)
    assert {p.modo for p in resultado.perfiles} == {"normal", "estricto"}
    assert "dieta vegana" in {p.perfil for p in resultado.perfiles}


# --- detección ---------------------------------------------------------------

def test_deteccion_de_alergenos(resultado):
    deteccion = resultado.deteccion_alergenos

    # 4 productos con alérgenos etiquetados (LIMPIA en null).
    assert deteccion.productos == 4
    assert deteccion.verdaderos_positivos == 1  # CON_LECHE
    assert deteccion.falsos_positivos == 1  # DE_MAS
    assert deteccion.falsos_negativos == 1  # SIN_DETECTAR
    assert deteccion.precision == 0.5
    assert deteccion.exhaustividad == 0.5
    assert {(d.codigo_barras, d.falsos_positivos, d.falsos_negativos)
            for d in deteccion.diferencias} == {
        (DE_MAS["code"], ("lacteos",), ()),
        (SIN_DETECTAR["code"], (), ("lacteos",)),
    }


def test_deteccion_de_trazas(resultado):
    deteccion = resultado.deteccion_trazas

    # CON_LECHE tiene trazas en null.
    assert deteccion.productos == 4
    assert deteccion.verdaderos_positivos == 1  # CON_TRAZA
    assert (deteccion.falsos_positivos, deteccion.falsos_negativos) == (0, 0)


# --- búsqueda ----------------------------------------------------------------

def test_compara_la_busqueda_base_con_la_personalizada(resultado):
    assert len(resultado.consultas) == 1  # solo las de restricción
    comparacion = resultado.consultas[0]

    # Relevantes según la detección del sistema: galletas sin lácteos ni
    # trazas de lácteos (SIN_DETECTAR y LIMPIA).
    assert comparacion.relevantes == 2
    # Con 5 productos y K = 5 los dos tops traen los mismos productos, pero
    # el base incluye los dos no aptos y el personalizado ninguno.
    assert comparacion.no_aptos_top_base == 2
    assert comparacion.no_aptos_top_personalizado == 0
    assert resultado.precision_personalizada == \
        comparacion.precision_personalizada
    assert resultado.no_aptos_top_base == comparacion.no_aptos_top_base


def test_con_un_top_corto_la_personalizada_es_mas_precisa(registros):
    resultado = evaluar_adaptativa(ETIQUETADO, CONJUNTO, registros,
                                   Instantanea.construir(registros), k=2,
                                   perfiles=LACTEOS)
    comparacion = resultado.consultas[0]

    # En /search, "leche" sube justo los productos con leche; la
    # personalizada deja arriba los dos aptos, que son los relevantes.
    assert set(comparacion.top_personalizado) == {SIN_DETECTAR["code"],
                                                  LIMPIA["code"]}
    assert comparacion.precision_personalizada == 1.0
    assert comparacion.precision_base < 1.0
    assert comparacion.no_aptos_top_base >= 1


def test_sin_productos_las_tasas_no_estan_definidas():
    resultado = evaluar_adaptativa([], CONJUNTO, [], Instantanea.vacia(),
                                   perfiles=LACTEOS)

    normal = perfil(resultado, "normal")
    assert normal.tasa_falsos_apto is None
    assert normal.tasa_falsos_no_apto is None
    assert resultado.deteccion_alergenos.precision is None
    assert resultado.consultas_evaluadas == []
    assert resultado.precision_base == 0.0
