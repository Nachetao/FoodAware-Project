import math

import pytest

from app.busqueda.bm25 import IndiceBM25, ParametrosBM25
from app.busqueda.documentos import (
    categorias_del_payload,
    documento_de_producto,
    documentos_indexables,
)
from app.busqueda.indice import PESOS_POR_DEFECTO, Documento, IndiceBusqueda
from app.schemas.producto import Calidad
from tests.payloads_off import productos_de_ejemplo

pytestmark = pytest.mark.recuperacion

# --- BM25 de un campo -------------------------------------------------------

# Corpus del ejemplo numérico del docstring de bm25.py.
CORPUS = {
    "a": ["galleta", "avena", "azucar", "sal"],
    "b": ["pan", "trigo", "azucar", "sal"],
    "c": ["leche", "azucar", "vitamina", "sal"],
}


def test_indice_invertido_guarda_frecuencias_y_largos():
    indice = IndiceBM25({"x": ["leche", "leche", "sal"], "y": ["sal"]})
    assert indice.postings == {"leche": {"x": 2}, "sal": {"x": 1, "y": 1}}
    assert indice.largos == {"x": 3, "y": 1}
    assert indice.largo_promedio == 2.0
    assert indice.n_documentos == 2


def test_idf_mayor_para_terminos_raros():
    indice = IndiceBM25(CORPUS)
    assert indice.idf("avena") > indice.idf("azucar")
    # Coinciden con el ejemplo numérico del docstring.
    assert indice.idf("avena") == pytest.approx(math.log(1 + 2.5 / 1.5))
    assert round(indice.idf("avena"), 3) == 0.981
    assert round(indice.idf("azucar"), 3) == 0.134
    # Un término presente en todos los documentos no resta.
    assert indice.idf("azucar") > 0


def test_ejemplo_numerico_del_docstring():
    # Largo igual al promedio (todos miden 4).
    indice = IndiceBM25(CORPUS)
    assert round(indice.puntuar(["avena"])["a"], 3) == 0.981
    # Largos 8, 2 y 2: avgdl = 4, así "a" mide el doble del promedio.
    doble = IndiceBM25({
        "a": ["galleta", "avena", "x", "x", "x", "x", "x", "x"],
        "b": ["pan", "azucar"],
        "c": ["leche", "azucar"],
    })
    assert doble.largo_promedio == 4.0
    assert round(doble.peso_tf(1, 8), 3) == 0.690
    assert round(doble.puntuar(["avena"])["a"], 3) == 0.676


def test_normalizacion_por_largo():
    corto = ["avena", "sal"]
    largo = ["avena", "sal", "agua", "aceite", "azucar", "cacao"]
    indice = IndiceBM25({"corto": corto, "largo": largo})
    puntajes = indice.puntuar(["avena"])
    assert puntajes["corto"] > puntajes["largo"]
    # Con b = 0 el largo no importa.
    sin_normalizar = IndiceBM25({"corto": corto, "largo": largo},
                                ParametrosBM25(b=0))
    puntajes = sin_normalizar.puntuar(["avena"])
    assert puntajes["corto"] == pytest.approx(puntajes["largo"])


def test_saturacion_de_tf():
    indice = IndiceBM25({"una": ["avena", "x", "y"], "dos": ["avena"] * 2
                         + ["x"], "otro": ["z", "w", "q"]})
    puntajes = indice.puntuar(["avena"])
    assert puntajes["una"] < puntajes["dos"] < 2 * puntajes["una"]


def test_consulta_repetida_cuenta_una_vez():
    indice = IndiceBM25(CORPUS)
    assert indice.puntuar(["avena", "avena"]) == indice.puntuar(["avena"])


def test_sin_coincidencias_no_devuelve_documentos():
    indice = IndiceBM25(CORPUS)
    assert indice.puntuar(["chocolate"]) == {}
    assert indice.puntuar([]) == {}


def test_indice_vacio():
    indice = IndiceBM25({})
    assert indice.n_documentos == 0 and indice.largo_promedio == 0.0
    assert indice.puntuar(["leche"]) == {}


@pytest.mark.parametrize("parametros", [{"k1": -1}, {"b": 1.5}, {"b": -0.1}])
def test_parametros_invalidos(parametros):
    with pytest.raises(ValueError):
        ParametrosBM25(**parametros)


# --- Índice por campos ------------------------------------------------------


def documento(id, nombre="", marca="", ingredientes="", categorias=""):
    return Documento(id=id, campos={
        "nombre": nombre, "marca": marca, "ingredientes": ingredientes,
        "categorias": categorias,
    })


def test_pesos_por_defecto():
    assert PESOS_POR_DEFECTO == {
        "nombre": 3.0, "marca": 2.0, "ingredientes": 1.0, "categorias": 1.5,
    }
    assert IndiceBusqueda().parametros == ParametrosBM25(k1=1.5, b=0.75)


def test_termino_en_el_nombre_pesa_mas_que_en_ingredientes():
    indice = IndiceBusqueda([
        documento("en_nombre", nombre="galletas de avena",
                  ingredientes="harina, azúcar"),
        documento("en_ingredientes", nombre="galletas de miel",
                  ingredientes="harina, avena"),
    ])
    primero, segundo = indice.buscar("avena")
    assert (primero.id, segundo.id) == ("en_nombre", "en_ingredientes")
    # Mismo idf y mismo largo: la diferencia es exactamente el peso 3 vs 1.
    assert primero.score == pytest.approx(3 * segundo.score)
    assert set(primero.por_campo) == {"nombre"}
    assert set(segundo.por_campo) == {"ingredientes"}


def test_suma_ponderada_de_campos():
    indice = IndiceBusqueda([
        documento("1", nombre="avena", marca="avena", ingredientes="avena",
                  categorias="avena"),
        documento("2", nombre="pan"),
    ])
    coincidencia = indice.buscar("avena")[0]
    assert set(coincidencia.por_campo) == {
        "nombre", "marca", "ingredientes", "categorias"
    }
    assert coincidencia.score == pytest.approx(
        sum(coincidencia.por_campo.values())
    )
    # Mismo contenido por campo: los aportes guardan la proporción de pesos.
    assert coincidencia.por_campo["categorias"] == pytest.approx(
        1.5 * coincidencia.por_campo["ingredientes"]
    )


def test_pesos_configurables():
    indice = IndiceBusqueda(
        [documento("1", nombre="avena"), documento("2", marca="avena")],
        pesos={"nombre": 1.0, "marca": 5.0},
    )
    assert [c.id for c in indice.buscar("avena")] == ["2", "1"]


def test_misma_tokenizacion_para_indexar_y_consultar():
    indice = IndiceBusqueda([documento("1", nombre="Galletas de AVENA")])
    assert [c.id for c in indice.buscar("galleta avena")] == ["1"]
    assert [c.id for c in indice.buscar("GALLETÁS")] == ["1"]


@pytest.mark.parametrize("consulta", ["chocolate", "xyz123"])
def test_consulta_sin_coincidencias(consulta):
    indice = IndiceBusqueda([documento("1", nombre="leche entera")])
    assert indice.buscar(consulta) == []


@pytest.mark.parametrize("consulta", ["de la", "y el", "de los con"])
def test_consulta_solo_con_stopwords(consulta):
    # "de" aparece en el documento, pero es stopword: no cuenta.
    indice = IndiceBusqueda([documento("1", nombre="leche de vaca")])
    assert indice.buscar(consulta) == []


def test_indice_vacio_no_falla():
    indice = IndiceBusqueda([])
    assert indice.vacio and indice.n_documentos == 0
    assert indice.buscar("leche") == []
    assert indice.terminos_distintos() == 0


def test_empate_por_id():
    indice = IndiceBusqueda([documento("b", nombre="leche"),
                             documento("a", nombre="leche")])
    assert [c.id for c in indice.buscar("leche")] == ["a", "b"]


def test_metadatos_del_indice():
    indice = IndiceBusqueda([
        documento("1", nombre="leche entera", marca="colun"),
        documento("2", nombre="leche descremada"),
    ])
    assert indice.n_documentos == 2
    # leche, entera, descremada, colun
    assert indice.terminos_distintos() == 4
    assert indice.largos_promedio()["nombre"] == 2.0
    assert indice.largos_promedio()["marca"] == 0.5


# --- Documentos desde productos ---------------------------------------------


def test_categorias_del_payload():
    payload = {
        "categories": "Snacks, Galletas,  ",
        "categories_tags": ["en:snacks", "en:sweet-biscuits", 3],
    }
    assert categorias_del_payload(payload) == [
        "Snacks", "Galletas", "snacks", "sweet biscuits"
    ]
    assert categorias_del_payload(None) == []
    assert categorias_del_payload({"categories": None}) == []


def test_documento_de_producto_con_categorias():
    pan = next(p for p in productos_de_ejemplo() if "Pan" in p.nombre)
    doc = documento_de_producto(pan, {"categories": "Panes de molde"})
    assert doc.id == pan.codigo_barras
    assert doc.campos["nombre"] == "Pan de molde integral"
    assert doc.campos["marca"] == "Panadería Andina"
    assert "harina de trigo integral" in doc.campos["ingredientes"]
    assert doc.campos["categorias"] == "Panes de molde"
    indice = IndiceBusqueda([doc])
    assert indice.buscar("panes")[0].por_campo.keys() == {
        "nombre", "categorias"
    }


def test_solo_se_indexan_productos_validos():
    validos = productos_de_ejemplo()
    invalido = validos[0].model_copy(update={
        "codigo_barras": "7802920000015",
        "calidad": Calidad(es_valido=False, problemas=["sin_ingredientes"],
                           completitud=0.5),
    })
    documentos = documentos_indexables(
        [(p, None) for p in [*validos, invalido]]
    )
    assert [d.id for d in documentos] == [p.codigo_barras for p in validos]
