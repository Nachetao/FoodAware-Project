"""POST /search/personalized completa: restricciones de la consulta, orden por
veredicto y score, filtrar y reordenar, y comparación con GET /search."""
import pytest

from app.schemas.adaptativo import RespuestaBusquedaPersonalizada
from tests.payloads_off import payload
from tests.test_adaptativo_endpoints import guardar

pytestmark = pytest.mark.recuperacion

# Chocolates: con leche, sin leche, con traza de leche y una leche con
# chocolate (que en la búsqueda base sube por tener las dos palabras).
CHOCOLATE_LECHE = payload(11, "Chocolate de leche",
                          "Azúcar, leche en polvo, manteca de cacao, "
                          "pasta de cacao")
CHOCOLATE_AMARGO = payload(12, "Chocolate amargo 70%",
                           "Pasta de cacao, azúcar, manteca de cacao")
CHOCOLATE_ALMENDRAS = payload(13, "Chocolate amargo con almendras",
                              "Pasta de cacao, azúcar, almendras. Puede "
                              "contener trazas de leche")
LECHE_CHOCOLATE = payload(14, "Leche con chocolate",
                          "Leche semidescremada, azúcar, cacao")
# Galletas.
GALLETAS_AVENA = payload(21, "Galletas de avena",
                         "Harina de trigo, avena, azúcar")
GALLETAS_ARROZ = payload(22, "Galletas de arroz", "Arroz inflado, sal",
                         labels_tags=["en:no-gluten"])
GALLETAS_SIN_GLUTEN = payload(23, "Galletas sin gluten",
                              "Harina de arroz, azúcar, aceite. Puede "
                              "contener trazas de gluten",
                              labels_tags=["en:no-gluten"])
GALLETAS_CHOCOLATE = payload(24, "Galletas de chocolate",
                             "Harina de trigo, azúcar, cacao, leche")
# Snacks.
SNACK_MANI = payload(31, "Snack de maní salado", "Maní, aceite, sal")
SNACK_PAPAS = payload(32, "Snack de papas", "Papas, aceite vegetal, sal")
SNACK_MAIZ = payload(33, "Snack de maíz",
                     "Maíz, aceite, sal. Puede contener maní")
SNACK_MIX = payload(34, "Snack mix de frutos secos",
                    "Almendras, nueces, maní, pasas")

CORPUS = [CHOCOLATE_LECHE, CHOCOLATE_AMARGO, CHOCOLATE_ALMENDRAS,
          LECHE_CHOCOLATE, GALLETAS_AVENA, GALLETAS_ARROZ,
          GALLETAS_SIN_GLUTEN, GALLETAS_CHOCOLATE, SNACK_MANI, SNACK_PAPAS,
          SNACK_MAIZ, SNACK_MIX]


@pytest.fixture
def corpus(repositorio, busqueda):
    guardar(repositorio, *CORPUS)
    busqueda.reconstruir_ahora()


def personalizada(client, consulta, perfil=None, **extra):
    response = client.post("/search/personalized", json={
        "consulta": consulta, "perfil": perfil or {}, "limit": 50, **extra})
    assert response.status_code == 200, response.text
    return RespuestaBusquedaPersonalizada.model_validate(response.json())


def codigos(respuesta):
    return [r.producto.codigo_barras for r in respuesta.resultados]


def veredictos(respuesta):
    return [(r.producto.codigo_barras, r.veredicto.veredicto)
            for r in respuesta.resultados]


def base(client, consulta):
    return client.get("/search", params={"q": consulta, "limit": 50}).json()


# --- chocolate sin leche -----------------------------------------------------

def test_chocolate_sin_leche_con_perfil_vacio(client, corpus):
    respuesta = personalizada(client, "chocolate sin leche")

    assert respuesta.interpretacion.terminos == ["chocolate"]
    assert [(r.texto, r.codigo) for r in
            respuesta.interpretacion.restricciones] == [
        ("sin leche", "lacteos")]
    assert respuesta.perfil_aplicado.alergias == ["lacteos"]
    # Primero el apto, después el que puede contener leche.
    assert veredictos(respuesta) == [
        (CHOCOLATE_AMARGO["code"], "apto"),
        (CHOCOLATE_ALMENDRAS["code"], "apto_con_advertencia")]
    assert respuesta.no_aptos.total == 3
    assert respuesta.no_aptos.texto == "3 ocultos por contener lácteos."


def test_chocolate_sin_leche_la_base_premia_justo_la_leche(client, corpus):
    """El problema que resuelve la versión adaptativa: en /search, "leche"
    es un término más y sube los productos con leche."""
    primero = base(client, "chocolate sin leche")["resultados"][0]

    assert primero["producto"]["codigo_barras"] in {
        CHOCOLATE_LECHE["code"], LECHE_CHOCOLATE["code"]}
    assert "lacteos" in primero["producto"]["alergenos"]


def test_chocolate_sin_leche_con_perfil(client, corpus):
    respuesta = personalizada(client, "chocolate sin leche",
                              {"alergias": ["frutos_secos"]})

    assert respuesta.perfil_aplicado.alergias == ["frutos_secos", "lacteos"]
    assert veredictos(respuesta) == [(CHOCOLATE_AMARGO["code"], "apto")]
    assert respuesta.no_aptos.texto == (
        "4 ocultos: 3 por contener lácteos y 1 por contener frutos secos.")


def test_chocolate_sin_leche_reordenar(client, corpus):
    respuesta = personalizada(client, "chocolate sin leche",
                              modo="reordenar")

    valores = [v for _, v in veredictos(respuesta)]
    assert valores == ["apto", "apto_con_advertencia",
                       "no_apto", "no_apto", "no_apto"]
    assert respuesta.total == 5
    assert respuesta.no_aptos.ocultos is False
    # Dentro de los no aptos, el orden es el del score BM25.
    no_aptos = respuesta.resultados[2:]
    assert [r.score for r in no_aptos] == sorted(
        (r.score for r in no_aptos), reverse=True)


# --- galletas sin gluten -----------------------------------------------------

def test_galletas_sin_gluten_con_perfil_vacio(client, corpus):
    respuesta = personalizada(client, "galletas sin gluten")

    assert respuesta.interpretacion.terminos == ["galleta"]
    assert veredictos(respuesta) == [
        (GALLETAS_ARROZ["code"], "apto"),
        (GALLETAS_SIN_GLUTEN["code"], "apto_con_advertencia")]
    assert {s.codigo_barras for s in
            respuesta.comparacion.salieron_del_top} >= {
        GALLETAS_AVENA["code"], GALLETAS_CHOCOLATE["code"]} & set(
        respuesta.comparacion.top_base)


def test_galletas_sin_gluten_en_modo_estricto(client, corpus):
    respuesta = personalizada(client, "galletas sin gluten",
                              {"modo_estricto": True})

    # La traza de gluten también la saca.
    assert veredictos(respuesta) == [(GALLETAS_ARROZ["code"], "apto")]
    assert respuesta.no_aptos.texto == (
        "3 ocultos: 2 por contener gluten y 1 por poder contener gluten.")


def test_galletas_sin_gluten_reordenar(client, corpus):
    respuesta = personalizada(client, "galletas sin gluten",
                              {"alergias": ["lacteos"]}, modo="reordenar")

    assert veredictos(respuesta)[:2] == [
        (GALLETAS_ARROZ["code"], "apto"),
        (GALLETAS_SIN_GLUTEN["code"], "apto_con_advertencia")]
    assert {c for c, v in veredictos(respuesta) if v == "no_apto"} == {
        GALLETAS_AVENA["code"], GALLETAS_CHOCOLATE["code"]}
    assert respuesta.no_aptos.texto == (
        "2 no aptos al final del ranking: 2 por contener gluten y 1 por "
        "contener lácteos.")


# --- snack sin maní ----------------------------------------------------------

def test_snack_sin_mani_con_perfil_vacio(client, corpus):
    respuesta = personalizada(client, "snack sin maní")

    assert respuesta.interpretacion.terminos == ["snack"]
    assert veredictos(respuesta) == [
        (SNACK_PAPAS["code"], "apto"),
        (SNACK_MAIZ["code"], "apto_con_advertencia")]
    assert respuesta.no_aptos.texto == "2 ocultos por contener maní."


def test_snack_sin_mani_con_dieta_vegana(client, corpus):
    respuesta = personalizada(client, "snack sin maní",
                              {"dietas": ["vegano"]})

    # Sin etiqueta vegana ninguno puede ser apto.
    assert {v for _, v in veredictos(respuesta)} == {"apto_con_advertencia"}
    assert set(codigos(respuesta)) == {SNACK_PAPAS["code"],
                                       SNACK_MAIZ["code"]}


def test_snack_sin_mani_reordenar_en_estricto(client, corpus):
    respuesta = personalizada(client, "snack sin maní",
                              {"modo_estricto": True}, modo="reordenar")

    assert veredictos(respuesta)[0] == (SNACK_PAPAS["code"], "apto")
    assert [v for _, v in veredictos(respuesta)[1:]] == ["no_apto"] * 3
    assert respuesta.no_aptos.texto == (
        "3 no aptos al final del ranking: 2 por contener maní y 1 por "
        "poder contener maní.")


# --- comparación con la base y casos borde -----------------------------------

@pytest.mark.parametrize("consulta", ["chocolate sin leche",
                                      "galletas sin gluten",
                                      "snack sin maní"])
def test_compara_con_search_de_la_consulta_original(client, corpus,
                                                    consulta):
    resultados_base = base(client, consulta)["resultados"]
    posicion_base = {r["producto"]["codigo_barras"]: r["posicion"]
                     for r in resultados_base}

    respuesta = personalizada(client, consulta)

    comparacion = respuesta.comparacion
    assert comparacion.top_base == [r["producto"]["codigo_barras"]
                                    for r in resultados_base[:5]]
    assert comparacion.top_personalizado == codigos(respuesta)[:5]
    for resultado in respuesta.resultados:
        assert resultado.posicion_base == posicion_base.get(
            resultado.producto.codigo_barras)
    for salida in comparacion.salieron_del_top:
        assert salida.codigo_barras in comparacion.top_base
        assert salida.codigo_barras not in comparacion.top_personalizado
        assert salida.posicion_base == posicion_base[salida.codigo_barras]
    assert comparacion.entraron_al_top == [
        c for c in comparacion.top_personalizado
        if c not in comparacion.top_base]
    assert respuesta.total_base == len(resultados_base)


def test_search_no_cambia(client, corpus):
    """La versión base es la referencia: GET /search no interpreta nada."""
    antes = base(client, "chocolate sin leche")
    personalizada(client, "chocolate sin leche")
    despues = base(client, "chocolate sin leche")

    assert ([r["producto"]["codigo_barras"] for r in antes["resultados"]]
            == [r["producto"]["codigo_barras"] for r in despues["resultados"]])
    assert antes["consulta"] == "chocolate sin leche"
    assert LECHE_CHOCOLATE["code"] in [r["producto"]["codigo_barras"]
                                       for r in antes["resultados"]]


def test_solo_restricciones_busca_la_consulta_completa(client, corpus):
    respuesta = personalizada(client, "sin gluten")

    assert respuesta.interpretacion.terminos == ["sin", "gluten"]
    assert respuesta.perfil_aplicado.alergias == ["gluten"]
    assert GALLETAS_SIN_GLUTEN["code"] in codigos(respuesta)
    for resultado in respuesta.resultados:
        assert "gluten" not in resultado.producto.alergenos


def test_restriccion_no_reconocida_queda_en_la_consulta(client, corpus):
    respuesta = personalizada(client, "galletas sin azúcar")

    assert respuesta.interpretacion.no_reconocidas == ["sin azúcar"]
    assert respuesta.interpretacion.restricciones == []
    assert respuesta.interpretacion.terminos == ["galleta", "sin", "azucar"]
    assert respuesta.perfil_aplicado.alergias == []


def test_leche_sin_lactosa_no_excluye_los_lacteos(client, corpus):
    respuesta = personalizada(client, "leche sin lactosa")

    assert respuesta.perfil_aplicado.dietas == ["sin_lactosa"]
    assert respuesta.perfil_aplicado.alergias == []
    # Sin la etiqueta sin_lactosa queda en advertencia, no se oculta.
    assert LECHE_CHOCOLATE["code"] in codigos(respuesta)
    assert respuesta.no_aptos.total == 0


def test_pagina_despues_de_filtrar(client, corpus):
    completa = personalizada(client, "chocolate sin leche")
    segunda = personalizada(client, "chocolate sin leche", limit=1,
                            offset=1)

    assert segunda.total == completa.total == 2
    assert codigos(segunda) == codigos(completa)[1:2]
    assert segunda.resultados[0].posicion == 2
