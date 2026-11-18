"""Contrato de la capacidad adaptativa: validaciones de los esquemas y
textos del resumen de no aptos."""
import pytest
from pydantic import ValidationError

from app.adaptativo.textos import contar_motivos, texto_no_aptos
from app.schemas.adaptativo import (
    AVISO_VEREDICTO,
    ConteoMotivo,
    MotivoNoApto,
    PerfilRestricciones,
    RespuestaBusquedaPersonalizada,
    SolicitudBusquedaPersonalizada,
    SolicitudCompatibilidad,
    Veredicto,
)
from app.schemas.enums import AllergenCode, DietLabel
from tests.payloads_off import productos_de_ejemplo

CODIGO = "7802920000015"


def veredicto(**cambios):
    datos = dict(codigo_barras=CODIGO, veredicto="apto",
                 datos_suficientes=True, explicacion="x", confianza="alta")
    datos.update(cambios)
    return Veredicto(**datos)


# --- perfil ----------------------------------------------------------------

def test_perfil_vacio_por_defecto():
    perfil = PerfilRestricciones()
    assert perfil.alergias == [] and perfil.dietas == []
    assert perfil.modo_estricto is False


def test_perfil_ignora_repetidos_y_conserva_el_orden():
    perfil = PerfilRestricciones(alergias=["mani", "lacteos", "mani"],
                                 dietas=["vegano", "vegano"])
    assert perfil.alergias == [AllergenCode.mani, AllergenCode.lacteos]
    assert perfil.dietas == [DietLabel.vegano]


@pytest.mark.parametrize("campo", ["usuario_id", "correo", "nombre"])
def test_perfil_rechaza_datos_de_identidad(campo):
    # El contrato es solo el perfil: un campo extra es un error de NestJS.
    with pytest.raises(ValidationError):
        PerfilRestricciones(alergias=["mani"], **{campo: "x"})


@pytest.mark.parametrize("datos", [
    {"alergias": ["leche"]},           # texto libre, no un código
    {"dietas": ["keto"]},
    {"alergias": "mani"},
])
def test_perfil_rechaza_codigos_desconocidos(datos):
    with pytest.raises(ValidationError):
        PerfilRestricciones(**datos)


def test_solicitud_de_compatibilidad_exige_el_perfil_y_nada_mas():
    assert SolicitudCompatibilidad(perfil={}).perfil == PerfilRestricciones()
    with pytest.raises(ValidationError):
        SolicitudCompatibilidad()
    with pytest.raises(ValidationError):
        SolicitudCompatibilidad(perfil={}, usuario_id="abc")


# --- solicitud de búsqueda -------------------------------------------------

def test_busqueda_personalizada_valores_por_defecto():
    solicitud = SolicitudBusquedaPersonalizada(consulta="  chocolate  ",
                                               perfil={})
    assert solicitud.consulta == "chocolate"
    assert (solicitud.modo, solicitud.limit, solicitud.offset) == (
        "filtrar", 10, 0)


@pytest.mark.parametrize("cambios", [
    {"consulta": "a"},
    {"consulta": "x" * 101},
    {"modo": "ocultar"},
    {"limit": 0},
    {"limit": 51},
    {"offset": -1},
    {"usuario_id": "abc"},
])
def test_busqueda_personalizada_rechaza_valores_invalidos(cambios):
    datos = {"consulta": "chocolate", "perfil": {}, **cambios}
    with pytest.raises(ValidationError):
        SolicitudBusquedaPersonalizada(**datos)


# --- veredicto -------------------------------------------------------------

def test_el_aviso_va_siempre():
    assert veredicto().aviso == AVISO_VEREDICTO
    assert "no es una garantía" in AVISO_VEREDICTO.lower()


def test_no_apto_exige_sus_motivos():
    with pytest.raises(ValidationError):
        veredicto(veredicto="no_apto", alergenos_en_conflicto=["lacteos"])
    no_apto = veredicto(
        veredicto="no_apto", alergenos_en_conflicto=["lacteos"],
        motivos_no_apto=[MotivoNoApto(tipo="alergeno", codigo="lacteos")],
    )
    assert no_apto.motivos_no_apto[0].codigo == AllergenCode.lacteos


def test_solo_no_apto_tiene_motivos_de_no_apto():
    with pytest.raises(ValidationError):
        veredicto(veredicto="apto_con_advertencia",
                  motivos_no_apto=[MotivoNoApto(tipo="datos_insuficientes")])


@pytest.mark.parametrize("cambios", [
    {"alergenos_en_conflicto": ["lacteos"]},
    {"trazas_en_conflicto": ["mani"]},
    {"dietas_no_confirmadas": ["vegano"]},
    {"conflictos": [{"codigo": "soya", "tipo": "posible",
                     "origen": "indicio"}]},
])
def test_un_apto_no_puede_tener_conflictos(cambios):
    with pytest.raises(ValidationError):
        veredicto(**cambios)


def test_confianza_alta_si_y_solo_si_no_hay_motivos():
    with pytest.raises(ValidationError):
        veredicto(confianza="alta", motivos_confianza=["completitud_media"])
    with pytest.raises(ValidationError):
        veredicto(confianza="media")
    assert veredicto(confianza="media",
                     motivos_confianza=["completitud_media"]).confianza == \
        "media"


def test_conflicto_de_dieta_usa_el_codigo_de_la_dieta():
    no_apto = veredicto(
        veredicto="no_apto",
        conflictos=[{"codigo": "vegano", "tipo": "dieta",
                     "origen": "fuente"}],
        motivos_no_apto=[{"tipo": "dieta", "codigo": "vegano"}],
    )
    assert no_apto.conflictos[0].codigo == DietLabel.vegano
    assert no_apto.motivos_no_apto[0].codigo == DietLabel.vegano


# --- respuesta de búsqueda -------------------------------------------------

def test_en_modo_filtrar_no_puede_haber_no_aptos_visibles():
    no_apto = veredicto(
        veredicto="no_apto", alergenos_en_conflicto=["lacteos"],
        motivos_no_apto=[MotivoNoApto(tipo="alergeno", codigo="lacteos")],
    )
    datos = {
        "consulta": "yogur", "interpretacion": {"terminos": ["yogur"]},
        "perfil_aplicado": {"alergias": ["lacteos"]}, "modo": "filtrar",
        "total": 1, "total_base": 1, "tiempo_ms": 1.0,
        "estado_fuente": "cache",
        "resultados": [{
            "producto": productos_de_ejemplo()[0].model_dump(mode="json"),
            "score": 1.0, "posicion": 1,
            "posicion_base": 1, "veredicto": no_apto.model_dump(),
        }],
        "no_aptos": {"total": 1, "ocultos": True, "texto": "x"},
        "comparacion": {"k": 5, "top_base": [CODIGO],
                        "top_personalizado": [CODIGO]},
    }
    with pytest.raises(ValidationError):
        RespuestaBusquedaPersonalizada(**datos)
    datos["modo"] = "reordenar"
    assert RespuestaBusquedaPersonalizada(**datos).resultados


# --- resumen de no aptos ---------------------------------------------------

def _motivos(*pares):
    return [MotivoNoApto(tipo=t, codigo=c) for t, c in pares]


def test_cuenta_cada_motivo_por_producto():
    conteo = contar_motivos([
        _motivos(("alergeno", "lacteos")),
        _motivos(("alergeno", "lacteos"), ("traza", "mani")),
        _motivos(("datos_insuficientes", None)),
    ])
    assert [(m.tipo, m.codigo, m.cantidad) for m in conteo] == [
        ("alergeno", AllergenCode.lacteos, 2),
        ("datos_insuficientes", None, 1),
        ("traza", AllergenCode.mani, 1),
    ]


@pytest.mark.parametrize("total, ocultos, motivos, esperado", [
    (0, True, [], "Ningún producto es no apto para este perfil."),
    (25, True, [("alergeno", "lacteos", 25)],
     "25 ocultos por contener lácteos."),
    (1, True, [("traza", "mani", 1)], "1 oculto por poder contener maní."),
    (3, True, [("alergeno", "lacteos", 2), ("dieta", "vegano", 1)],
     "3 ocultos: 2 por contener lácteos y 1 por no cumplir la dieta "
     "vegana."),
    (2, False, [("alergeno", "lacteos", 2), ("traza", "mani", 1)],
     "2 no aptos al final del ranking: 2 por contener lácteos y 1 por "
     "poder contener maní."),
    (1, True, [("datos_insuficientes", None, 1)],
     "1 oculto por datos insuficientes."),
    (1, True, [("posible", "soya", 1)],
     "1 oculto por un posible indicio de soya."),
])
def test_texto_del_resumen(total, ocultos, motivos, esperado):
    conteos = [ConteoMotivo(tipo=t, codigo=c, cantidad=n)
               for t, c, n in motivos]
    assert texto_no_aptos(total, ocultos, conteos) == esperado
