"""POST /products/{codigo_barras}/compatibility y POST /search/personalized:
formato del contrato, filtrado, resumen de no aptos y comparación con el
ranking base."""
import uuid
from datetime import datetime, timezone

import pytest

from app.schemas.adaptativo import (
    RespuestaBusquedaPersonalizada,
    Veredicto,
)
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import LECHE, payload

pytestmark = pytest.mark.recuperacion

BASE = "https://world.openfoodfacts.org"
AHORA = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)

AVENA = payload(1, "Galletas de avena",
                "Harina de trigo, avena, azúcar, mantequilla")
ARROZ = payload(2, "Galletas de arroz", "Arroz inflado, sal")
MANI = payload(3, "Galletas de maní", "Harina de arroz, maní, azúcar")
COCO = payload(4, "Galletas de coco",
               "Harina de arroz, coco, azúcar. Puede contener trazas de maní")
CORPUS = [AVENA, ARROZ, MANI, COCO]
PERFIL = {"alergias": ["lacteos", "mani"]}


def guardar(repositorio, *payloads):
    for p in payloads:
        producto = mapear_producto(p, run_id=uuid.uuid4(),
                                   recuperado_en=AHORA, base_url=BASE)
        repositorio.guardar_producto(producto, p)


@pytest.fixture
def corpus(repositorio, busqueda):
    guardar(repositorio, *CORPUS)
    busqueda.reconstruir_ahora()


def compatibilidad(client, codigo, perfil):
    return client.post(f"/products/{codigo}/compatibility",
                       json={"perfil": perfil})


def personalizada(client, consulta="galletas", perfil=PERFIL, **extra):
    response = client.post("/search/personalized",
                           json={"consulta": consulta, "perfil": perfil,
                                 **extra})
    assert response.status_code == 200, response.text
    return RespuestaBusquedaPersonalizada.model_validate(response.json())


# --- compatibilidad --------------------------------------------------------

def test_alergeno_declarado_por_la_fuente_es_no_apto_con_confianza_alta(
    client, repositorio
):
    guardar(repositorio, LECHE)

    response = compatibilidad(client, LECHE["code"], {"alergias": ["lacteos"]})

    assert response.status_code == 200
    veredicto = Veredicto.model_validate(response.json())
    assert veredicto.veredicto == "no_apto"
    assert veredicto.alergenos_en_conflicto == ["lacteos"]
    assert [(c.tipo, c.origen) for c in veredicto.conflictos] == [
        ("alergeno", "fuente")]
    assert [(m.tipo, m.codigo) for m in veredicto.motivos_no_apto] == [
        ("alergeno", "lacteos")]
    assert veredicto.confianza == "alta"
    assert "garantía" in veredicto.aviso


def test_alergeno_detectado_solo_en_el_texto_baja_la_confianza(
    client, repositorio
):
    guardar(repositorio, AVENA)

    veredicto = Veredicto.model_validate(
        compatibilidad(client, AVENA["code"], PERFIL).json())

    assert veredicto.veredicto == "no_apto"
    assert veredicto.conflictos[0].origen == "texto"
    assert veredicto.confianza == "media"
    assert veredicto.motivos_confianza == ["conflicto_solo_en_texto"]


def test_traza_en_conflicto_nunca_es_apto(client, repositorio):
    guardar(repositorio, COCO)

    veredicto = Veredicto.model_validate(
        compatibilidad(client, COCO["code"], PERFIL).json())

    assert veredicto.veredicto == "apto_con_advertencia"
    assert veredicto.trazas_en_conflicto == ["mani"]


def test_producto_inexistente_responde_404_del_contrato(client):
    response = compatibilidad(client, "7802920000022", PERFIL)

    assert response.status_code == 404
    assert response.json()["error"]["codigo"] == "NOT_FOUND"


@pytest.mark.parametrize("codigo, cuerpo", [
    ("123", {"perfil": PERFIL}),
    (LECHE["code"], {}),
    (LECHE["code"], {"perfil": {"alergias": ["leche"]}}),
    (LECHE["code"], {"perfil": PERFIL, "usuario_id": "abc"}),
    (LECHE["code"], {"perfil": {**PERFIL, "correo": "a@b.cl"}}),
])
def test_solicitud_invalida_responde_422_del_contrato(client, codigo, cuerpo):
    response = client.post(f"/products/{codigo}/compatibility", json=cuerpo)

    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


# --- búsqueda personalizada ------------------------------------------------

def test_filtrar_oculta_los_no_aptos_y_dice_por_que(client, corpus):
    respuesta = personalizada(client)

    codigos = [r.producto.codigo_barras for r in respuesta.resultados]
    assert sorted(codigos) == sorted([ARROZ["code"], COCO["code"]])
    assert respuesta.total == 2
    assert respuesta.total_base == 4
    assert respuesta.no_aptos.total == 2
    assert respuesta.no_aptos.ocultos is True
    assert [(m.tipo, m.codigo, m.cantidad)
            for m in respuesta.no_aptos.motivos] == [
        ("alergeno", "lacteos", 1), ("alergeno", "mani", 1)]
    assert respuesta.no_aptos.texto == (
        "2 ocultos: 1 por contener lácteos y 1 por contener maní.")
    assert "garantía" in respuesta.aviso


def test_reordenar_deja_los_no_aptos_al_final(client, corpus):
    respuesta = personalizada(client, modo="reordenar")

    veredictos = [r.veredicto.veredicto for r in respuesta.resultados]
    assert veredictos[-2:] == ["no_apto", "no_apto"]
    assert "no_apto" not in veredictos[:-2]
    assert respuesta.total == 4
    assert respuesta.no_aptos.ocultos is False
    assert respuesta.no_aptos.texto.startswith(
        "2 no aptos al final del ranking")


def test_compara_con_el_ranking_base_de_search(client, corpus):
    base = client.get("/search", params={"q": "galletas", "limit": 50}).json()
    posicion_base = {r["producto"]["codigo_barras"]: r["posicion"]
                     for r in base["resultados"]}

    respuesta = personalizada(client)

    for resultado in respuesta.resultados:
        assert resultado.posicion_base == posicion_base[
            resultado.producto.codigo_barras]
    comparacion = respuesta.comparacion
    assert comparacion.k == 5
    assert comparacion.top_base == [r["producto"]["codigo_barras"]
                                    for r in base["resultados"]]
    assert {s.codigo_barras for s in comparacion.salieron_del_top} == {
        AVENA["code"], MANI["code"]}
    for salida in comparacion.salieron_del_top:
        assert salida.posicion is None
        assert salida.veredicto == "no_apto"
        assert salida.posicion_base == posicion_base[salida.codigo_barras]
    assert comparacion.entraron_al_top == []


def test_pagina_despues_de_filtrar(client, corpus):
    primera = personalizada(client, limit=1)
    segunda = personalizada(client, limit=1, offset=1)

    assert primera.total == segunda.total == 2
    assert [r.posicion for r in primera.resultados + segunda.resultados] == [
        1, 2]
    assert (primera.resultados[0].producto.codigo_barras
            != segunda.resultados[0].producto.codigo_barras)


def test_perfil_vacio_no_oculta_nada(client, corpus):
    respuesta = personalizada(client, perfil={})

    assert respuesta.total == respuesta.total_base == 4
    assert respuesta.no_aptos.total == 0
    assert respuesta.no_aptos.texto == (
        "Ningún producto es no apto para este perfil.")
    assert respuesta.comparacion.salieron_del_top == []


def test_sin_coincidencias_responde_vacio(client, corpus):
    respuesta = personalizada(client, consulta="atún")

    assert respuesta.total == respuesta.total_base == 0
    assert respuesta.resultados == []
    assert respuesta.comparacion.top_base == []


def test_interpretacion_trae_los_terminos_buscados(client, corpus):
    respuesta = personalizada(client, consulta="Galletas de Maní")

    assert respuesta.interpretacion.terminos == ["galleta", "mani"]
    assert respuesta.perfil_aplicado.alergias == ["lacteos", "mani"]


@pytest.mark.parametrize("cuerpo", [
    {"consulta": "galletas"},
    {"consulta": "g", "perfil": {}},
    {"consulta": "galletas", "perfil": {}, "modo": "ocultar"},
    {"consulta": "galletas", "perfil": {}, "usuario_id": "abc"},
])
def test_busqueda_invalida_responde_422(client, cuerpo):
    response = client.post("/search/personalized", json=cuerpo)

    assert response.status_code == 422
    assert response.json()["error"]["codigo"] == "VALIDATION_ERROR"


def test_los_endpoints_estan_en_el_contrato(client):
    rutas = client.get("/openapi.json").json()["paths"]

    assert "post" in rutas["/products/{codigo_barras}/compatibility"]
    assert "post" in rutas["/search/personalized"]
