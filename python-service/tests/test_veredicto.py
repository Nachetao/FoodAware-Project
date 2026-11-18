"""Motor del veredicto: cada fila de la tabla de reglas en modo normal y
estricto, la confianza, la explicación y que nunca haya un falso "apto"."""
import itertools
import uuid
from datetime import datetime, timezone

import pytest

from app.adaptativo.veredicto import evaluar_veredicto
from app.schemas.adaptativo import AVISO_VEREDICTO, PerfilRestricciones
from app.schemas.producto import Calidad, Producto
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import payload

BASE = mapear_producto(
    payload(1, "Galletas de arroz", "Arroz, sal"), run_id=uuid.uuid4(),
    recuperado_en=datetime(2026, 11, 18, tzinfo=timezone.utc),
    base_url="https://world.openfoodfacts.org",
)


def producto(alergenos=(), trazas=(), dietas=(), problemas=(),
             completitud=1.0, ingredientes=("arroz", "sal")):
    # model_validate y no model_copy: así los códigos quedan como enums,
    # igual que en un producto real.
    return Producto.model_validate({
        **BASE.model_dump(),
        "alergenos": list(alergenos),
        "trazas": list(trazas),
        "etiquetas_dieta": list(dietas),
        "ingredientes": list(ingredientes),
        "calidad": Calidad(es_valido=bool(ingredientes),
                           problemas=list(problemas),
                           completitud=completitud).model_dump(),
    })


def evaluar(prod, estricto=False, **perfil):
    return evaluar_veredicto(
        prod, PerfilRestricciones(modo_estricto=estricto, **perfil))


SIN_INGREDIENTES = dict(ingredientes=(), problemas=["sin_ingredientes"],
                        completitud=0.83)

# (caso, producto, perfil, veredicto normal, veredicto estricto)
TABLA = [
    # Fila 1: alérgeno del perfil como ingrediente.
    ("1 alérgeno declarado", dict(alergenos=["lacteos"]),
     dict(alergias=["lacteos"]), "no_apto", "no_apto"),
    ("1 alérgeno solo en el texto",
     dict(alergenos=["lacteos"],
          problemas=["alergeno_detectado_en_texto:lacteos"]),
     dict(alergias=["lacteos"]), "no_apto", "no_apto"),
    # Fila 2: dieta contradicha.
    ("2 vegano con lácteos", dict(alergenos=["lacteos"]),
     dict(dietas=["vegano"]), "no_apto", "no_apto"),
    ("2 vegano con huevo", dict(alergenos=["huevo"], dietas=["vegano"]),
     dict(dietas=["vegano"]), "no_apto", "no_apto"),
    ("2 vegetariano con pescado", dict(alergenos=["pescado"]),
     dict(dietas=["vegetariano"]), "no_apto", "no_apto"),
    ("2 sin gluten con gluten", dict(alergenos=["gluten"]),
     dict(dietas=["sin_gluten"]), "no_apto", "no_apto"),
    # Fila 3: traza de algo que el perfil evita.
    ("3 traza de una alergia", dict(trazas=["mani"]),
     dict(alergias=["mani"]), "apto_con_advertencia", "no_apto"),
    ("3 traza prohibida por la dieta",
     dict(trazas=["gluten"], dietas=["sin_gluten"]),
     dict(dietas=["sin_gluten"]), "apto_con_advertencia", "no_apto"),
    ("3 traza de lácteos en un vegano",
     dict(trazas=["lacteos"], dietas=["vegano", "vegetariano"]),
     dict(dietas=["vegano"]), "apto_con_advertencia", "no_apto"),
    # Fila 4: alérgeno posible.
    ("4 indicio de soya", dict(problemas=["alergeno_posible:soya"]),
     dict(alergias=["soya"]), "apto_con_advertencia", "no_apto"),
    # Fila 5: datos insuficientes, con restricciones en el perfil.
    ("5 sin ingredientes", SIN_INGREDIENTES, dict(alergias=["mani"]),
     "apto_con_advertencia", "no_apto"),
    ("5 alérgenos no reconocidos",
     dict(problemas=["alergenos_no_reconocidos"]), dict(alergias=["mani"]),
     "apto_con_advertencia", "no_apto"),
    ("5 completitud baja", dict(completitud=0.33), dict(alergias=["mani"]),
     "apto_con_advertencia", "no_apto"),
    ("5 solo con una dieta", dict(completitud=0.33, dietas=["vegano"]),
     dict(dietas=["vegano"]), "apto_con_advertencia", "no_apto"),
    # Fila 6: dieta que el producto no declara cumplir.
    ("6 vegano sin etiqueta", dict(), dict(dietas=["vegano"]),
     "apto_con_advertencia", "apto_con_advertencia"),
    ("6 sin lactosa con lácteos y sin etiqueta", dict(alergenos=["lacteos"]),
     dict(dietas=["sin_lactosa"]), "apto_con_advertencia",
     "apto_con_advertencia"),
    # Fila 7: nada de lo anterior.
    ("7 sin conflictos", dict(), dict(alergias=["mani", "lacteos"]),
     "apto", "apto"),
    ("7 alérgeno que no está en el perfil", dict(alergenos=["lacteos"]),
     dict(alergias=["soya"]), "apto", "apto"),
    ("7 dieta declarada", dict(dietas=["vegano", "vegetariano"]),
     dict(dietas=["vegano"]), "apto", "apto"),
    ("7 vegetariano con huevo y etiqueta",
     dict(alergenos=["huevo"], dietas=["vegetariano"]),
     dict(dietas=["vegetariano"]), "apto", "apto"),
    ("7 sin lactosa con lácteos y etiqueta",
     dict(alergenos=["lacteos"], dietas=["sin_lactosa"]),
     dict(dietas=["sin_lactosa"]), "apto", "apto"),
    ("7 perfil vacío con datos insuficientes", SIN_INGREDIENTES, dict(),
     "apto", "apto"),
]


@pytest.mark.parametrize("estricto", [False, True],
                         ids=["normal", "estricto"])
@pytest.mark.parametrize(
    "caso, prod, perfil, normal, en_estricto", TABLA,
    ids=[fila[0] for fila in TABLA],
)
def test_tabla_de_reglas(caso, prod, perfil, normal, en_estricto, estricto):
    veredicto = evaluar(producto(**prod), estricto, **perfil)

    assert veredicto.veredicto == (en_estricto if estricto else normal)
    assert veredicto.aviso == AVISO_VEREDICTO
    assert veredicto.explicacion


# --- detalle de cada fila ----------------------------------------------------

def test_alergenos_en_conflicto_y_motivos():
    veredicto = evaluar(producto(alergenos=["mani", "lacteos", "soya"]),
                        alergias=["lacteos", "mani"])

    assert veredicto.alergenos_en_conflicto == ["mani", "lacteos"]
    assert [(m.tipo, m.codigo) for m in veredicto.motivos_no_apto] == [
        ("alergeno", "mani"), ("alergeno", "lacteos")]
    assert veredicto.explicacion == (
        "Contiene maní y lácteos, que están en tu perfil.")


def test_dieta_contradicha_lleva_el_conflicto_de_la_dieta():
    veredicto = evaluar(producto(alergenos=["lacteos", "huevo"]),
                        dietas=["vegano"])

    assert veredicto.alergenos_en_conflicto == []
    assert [(c.codigo, c.tipo, c.origen) for c in veredicto.conflictos] == [
        ("vegano", "dieta", "fuente")]
    assert [(m.tipo, m.codigo) for m in veredicto.motivos_no_apto] == [
        ("dieta", "vegano")]
    # Contradicha no es lo mismo que "no confirmada".
    assert veredicto.dietas_no_confirmadas == []
    assert veredicto.explicacion == (
        "No cumple la dieta vegana: contiene lácteos y huevo.")


def test_traza_en_modo_normal_explica_y_no_tiene_motivos_de_no_apto():
    veredicto = evaluar(producto(trazas=["mani"]), alergias=["mani"])

    assert veredicto.trazas_en_conflicto == ["mani"]
    assert veredicto.motivos_no_apto == []
    assert veredicto.explicacion == "Puede contener trazas de maní."


def test_traza_en_modo_estricto_es_el_motivo():
    veredicto = evaluar(producto(trazas=["mani"]), True, alergias=["mani"])

    assert [(m.tipo, m.codigo) for m in veredicto.motivos_no_apto] == [
        ("traza", "mani")]
    assert veredicto.explicacion == (
        "Puede contener trazas de maní (modo estricto).")


def test_una_traza_de_algo_que_ya_es_ingrediente_no_se_repite():
    veredicto = evaluar(producto(alergenos=["mani"], trazas=["mani"]),
                        alergias=["mani"])

    assert veredicto.trazas_en_conflicto == []
    assert [c.tipo for c in veredicto.conflictos] == ["alergeno"]


def test_alergeno_y_traza_en_estricto_cuentan_los_dos_motivos():
    prod = producto(alergenos=["lacteos"], trazas=["mani"])
    normal = evaluar(prod, alergias=["lacteos", "mani"])
    estricto = evaluar(prod, True, alergias=["lacteos", "mani"])

    assert [m.tipo for m in normal.motivos_no_apto] == ["alergeno"]
    assert [m.tipo for m in estricto.motivos_no_apto] == [
        "alergeno", "traza"]
    # En modo normal la traza se informa, pero no entra en la explicación
    # de un no_apto.
    assert normal.trazas_en_conflicto == ["mani"]
    assert normal.explicacion == "Contiene lácteos, que está en tu perfil."


def test_indicio_de_un_alergeno_del_perfil():
    veredicto = evaluar(producto(problemas=["alergeno_posible:soya"]),
                        alergias=["soya"])

    assert [(c.codigo, c.tipo, c.origen) for c in veredicto.conflictos] == [
        ("soya", "posible", "indicio")]
    assert veredicto.confianza == "baja"
    assert veredicto.motivos_confianza == ["indicio_sin_confirmar"]
    assert veredicto.explicacion.startswith("Podría contener soya")


def test_indicio_de_un_alergeno_que_no_esta_en_el_perfil_no_importa():
    veredicto = evaluar(producto(problemas=["alergeno_posible:soya"]),
                        alergias=["mani"])

    assert veredicto.veredicto == "apto"


def test_datos_insuficientes_en_estricto():
    veredicto = evaluar(producto(**SIN_INGREDIENTES), True,
                        alergias=["mani"])

    assert veredicto.datos_suficientes is False
    assert [(m.tipo, m.codigo) for m in veredicto.motivos_no_apto] == [
        ("datos_insuficientes", None)]
    assert veredicto.confianza == "baja"
    assert veredicto.motivos_confianza == ["sin_ingredientes"]
    assert veredicto.explicacion == (
        "No podemos revisarlo bien: no tiene lista de ingredientes "
        "(modo estricto).")


def test_datos_insuficientes_explica_todas_las_razones():
    veredicto = evaluar(
        producto(problemas=["alergenos_no_reconocidos"], completitud=0.33),
        alergias=["mani"])

    assert veredicto.explicacion == (
        "No podemos revisarlo bien: declara alérgenos que no reconocemos y "
        "su ficha está muy incompleta.")
    assert veredicto.motivos_confianza == ["completitud_baja",
                                           "alergenos_no_reconocidos"]


def test_dietas_no_confirmadas():
    veredicto = evaluar(producto(dietas=["vegetariano"]),
                        dietas=["vegano", "sin_gluten", "vegetariano"])

    assert veredicto.dietas_no_confirmadas == ["vegano", "sin_gluten"]
    assert veredicto.explicacion == (
        "No declara cumplir las dietas vegana y sin gluten.")


def test_apto_explica_lo_que_reviso():
    con_dieta = evaluar(producto(dietas=["vegano", "vegetariano"]),
                        alergias=["mani"], dietas=["vegano"])
    vacio = evaluar(producto())

    assert con_dieta.explicacion == (
        "No encontramos ninguno de tus alérgenos como ingrediente, como "
        "traza ni como indicio. Declara cumplir la dieta vegana.")
    assert vacio.veredicto == "apto"
    assert vacio.explicacion.startswith("Tu perfil no tiene alergias")


def test_origen_desconocido_en_los_problemas_se_ignora():
    veredicto = evaluar(
        producto(alergenos=["lacteos"],
                 problemas=["alergeno_detectado_en_texto:otro"]),
        alergias=["lacteos"])

    assert veredicto.conflictos[0].origen == "fuente"


# --- confianza ---------------------------------------------------------------

@pytest.mark.parametrize("prod, perfil, confianza, motivos", [
    # no_apto: depende solo del conflicto que lo decidió.
    (dict(alergenos=["lacteos"], completitud=0.67),
     dict(alergias=["lacteos"]), "alta", []),
    (dict(alergenos=["lacteos"],
          problemas=["alergeno_detectado_en_texto:lacteos"]),
     dict(alergias=["lacteos"]), "media", ["conflicto_solo_en_texto"]),
    # apto y advertencia: el más bajo de los factores.
    (dict(), dict(alergias=["mani"]), "alta", []),
    (dict(completitud=0.67), dict(alergias=["mani"]), "media",
     ["completitud_media"]),
    (dict(trazas=["mani"]), dict(alergias=["mani"]), "alta", []),
    (dict(trazas=["mani"], problemas=["traza_detectada_en_texto:mani"]),
     dict(alergias=["mani"]), "media", ["conflicto_solo_en_texto"]),
    (dict(trazas=["mani"], completitud=0.67,
          problemas=["alergeno_posible:soya"]),
     dict(alergias=["mani", "soya"]), "baja",
     ["completitud_media", "indicio_sin_confirmar"]),
    (dict(completitud=0.33), dict(), "baja", ["completitud_baja"]),
])
def test_confianza(prod, perfil, confianza, motivos):
    veredicto = evaluar(producto(**prod), **perfil)

    assert veredicto.confianza == confianza
    assert veredicto.motivos_confianza == motivos


def test_dieta_contradicha_solo_en_el_texto_tiene_confianza_media():
    veredicto = evaluar(
        producto(alergenos=["lacteos"],
                 problemas=["alergeno_detectado_en_texto:lacteos"]),
        dietas=["vegano"])

    assert veredicto.conflictos[0].origen == "texto"
    assert veredicto.confianza == "media"


def test_un_apto_con_restricciones_nunca_tiene_confianza_baja():
    for completitud in (0.0, 0.17, 0.33, 0.5, 0.67, 0.83, 1.0):
        veredicto = evaluar(producto(completitud=completitud),
                            alergias=["mani"])
        if veredicto.veredicto == "apto":
            assert veredicto.confianza != "baja"


# --- nunca un falso "apto" ---------------------------------------------------

@pytest.mark.parametrize("estricto", [False, True])
def test_cualquier_riesgo_impide_el_apto(estricto):
    """Todas las combinaciones de riesgos: si hay alguno, no es apto."""
    for (alergeno, traza, posible, sin_ingr, no_reconocidos, incompleto,
         vegano, etiqueta_vegana) in itertools.product([False, True],
                                                       repeat=8):
        prod = producto(
            alergenos=["mani"] if alergeno else [],
            trazas=["mani"] if traza else [],
            dietas=["vegano", "vegetariano"] if etiqueta_vegana else [],
            problemas=(["alergeno_posible:mani"] if posible else [])
            + (["alergenos_no_reconocidos"] if no_reconocidos else []),
            completitud=0.33 if incompleto else 1.0,
            ingredientes=() if sin_ingr else ("arroz", "sal"),
        )
        veredicto = evaluar(prod, estricto, alergias=["mani"],
                            dietas=["vegano"] if vegano else [])
        riesgo = (alergeno or traza or posible or sin_ingr or no_reconocidos
                  or incompleto or (vegano and not etiqueta_vegana))
        assert (veredicto.veredicto == "apto") == (not riesgo), (
            alergeno, traza, posible, sin_ingr, no_reconocidos, incompleto,
            vegano, etiqueta_vegana)
