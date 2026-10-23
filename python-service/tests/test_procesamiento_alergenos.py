import pytest

from app.procesamiento.alergenos import (
    alergenos_en_etiqueta,
    detectar_alergenos,
    detectar_en_texto,
)
from app.procesamiento.ingredientes import analizar_ingredientes
from app.procesamiento.sinonimos_alergenos import SINONIMOS
from app.procesamiento.texto import normalizar
from app.schemas.enums import AllergenCode

pytestmark = pytest.mark.recuperacion


def alergenos(texto):
    return [a.value for a in detectar_en_texto(texto).alergenos]


def trazas(texto):
    return [t.value for t in detectar_en_texto(texto).trazas]


def test_diccionario_cubre_los_14_codigos():
    assert set(SINONIMOS) == set(AllergenCode)
    for codigo, sinonimos in SINONIMOS.items():
        assert all(normalizar(s) for s in sinonimos), codigo


@pytest.mark.parametrize(
    "texto, esperado",
    [
        # lacteos
        ("leche entera", ["lacteos"]),
        ("caseinato de sodio", ["lacteos"]),
        ("suero lácteo en polvo", ["lacteos"]),
        ("SUERO DE LECHE", ["lacteos"]),
        ("lactosa", ["lacteos"]),
        ("crema de leche", ["lacteos"]),
        ("queso mantecoso", ["lacteos"]),
        ("yoghurt natural", ["lacteos"]),
        ("lactoalbúmina", ["lacteos"]),
        ("sólidos lácteos", ["lacteos"]),
        ("manjar", ["lacteos"]),
        ("whole milk powder", ["lacteos"]),
        # gluten
        ("harina de trigo", ["gluten"]),
        ("harina enriquecida", ["gluten"]),
        ("cebada malteada", ["gluten"]),
        ("extracto de malta", ["gluten"]),
        ("hojuelas de avena", ["gluten"]),
        ("sémola", ["gluten"]),
        ("gluten de trigo", ["gluten"]),
        ("wheat flour", ["gluten"]),
        # huevo
        ("huevos enteros", ["huevo"]),
        ("yema de huevo", ["huevo"]),
        ("clara en polvo", ["huevo"]),
        ("ovoalbúmina", ["huevo"]),
        ("lisozima", ["huevo"]),
        # mani
        ("maní tostado", ["mani"]),
        ("cacahuetes", ["mani"]),
        ("maníes", ["mani"]),
        # frutos_secos
        ("almendras laminadas", ["frutos_secos"]),
        ("NUECES", ["frutos_secos"]),
        ("castaña de cajú", ["frutos_secos"]),
        ("trozos de avellana", ["frutos_secos"]),
        ("pistachos", ["frutos_secos"]),
        ("nuez pecana", ["frutos_secos"]),
        # soya
        ("lecitina de soya", ["soya"]),
        ("proteína de soja", ["soya"]),
        ("lecitina", ["soya"]),
        # sesamo
        ("semillas de sésamo", ["sesamo"]),
        ("ajonjolí", ["sesamo"]),
        ("tahini", ["sesamo"]),
        # sulfitos
        ("metabisulfito de sodio", ["sulfitos"]),
        ("conservante (INS 223)", ["sulfitos"]),
        ("E-220", ["sulfitos"]),
        ("anhídrido sulfuroso", ["sulfitos"]),
        # altramuces
        ("harina de lupino", ["altramuces"]),
        ("altramuces", ["altramuces"]),
        # pescado, crustaceos, moluscos
        ("atún en agua", ["pescado"]),
        ("jurel", ["pescado"]),
        ("aceite de pescado", ["pescado"]),
        ("camarones", ["crustaceos"]),
        ("jaiba", ["crustaceos"]),
        ("choritos", ["moluscos"]),
        ("calamar", ["moluscos"]),
        ("mariscos", ["crustaceos", "moluscos"]),
        # mostaza y apio
        ("mostaza", ["mostaza"]),
        ("sal de apio", ["apio"]),
        # Varios a la vez
        ("pan rallado (harina, huevo, leche)",
         ["lacteos", "gluten", "huevo"]),
    ],
)
def test_detecta_sinonimos(texto, esperado):
    assert alergenos(texto) == esperado


@pytest.mark.parametrize(
    "texto",
    [
        "agua", "azúcar", "sal de mar", "aceite de maravilla",
        "almidón de maíz", "maltodextrina", "ácido láctico",
        "lactato de calcio",
        "jarabe de glucosa", "goma guar", "sulfato de calcio", "natural",
        # Palabras que solo contienen al término no cuentan.
        "coconut", "nutmeg", "manifiesto", "lechería", "quesadilla",
        "clarificado", "nataliza",
    ],
)
def test_sin_falsos_positivos_obvios(texto):
    assert alergenos(texto) == []


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("leche de coco", []),
        ("LECHE DE COCO EN POLVO", []),
        ("leche de almendras", ["frutos_secos"]),
        ("bebida a base de leche de soya", ["soya"]),
        ("leche de avena", ["gluten"]),
        ("mantequilla de maní", ["mani"]),
        ("manteca de cacao", []),
        ("mantequilla de cacao", []),
        ("manteca de cerdo", []),
        ("manteca vegetal", []),
        ("crema de cacao", []),
        ("crema de avellanas", ["frutos_secos"]),
        ("nuez moscada", []),
        ("harina de maíz", []),
        ("harina de arroz", []),
        ("harina de pescado", ["pescado"]),
        ("sémola de maíz", []),
        ("trigo sarraceno", []),
        ("lecitina de girasol", []),
        ("peanut butter", ["mani"]),
        ("cocoa butter", []),
        # La excepción no tapa otra mención real en el mismo fragmento.
        ("leche de coco y leche entera", ["lacteos"]),
        ("manteca de cacao, manteca", ["lacteos"]),
    ],
)
def test_excepciones(texto, esperado):
    assert alergenos(texto) == esperado


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("sin gluten", []),
        ("libre de lactosa", []),
        ("libres de lactosa", []),
        ("leche sin lactosa", ["lacteos"]),  # sigue siendo leche
        ("sin gluten ni lactosa", []),
        ("no contiene maní", []),
        ("gluten free", []),
        ("sin harina de trigo", []),
        ("sin trazas de maní", []),
        ("avena sin gluten", ["gluten"]),  # la avena se marca igual
        ("exento de huevo", []),
    ],
)
def test_negaciones(texto, esperado):
    assert alergenos(texto) == esperado
    assert detectar_en_texto(texto).trazas == ()


@pytest.mark.parametrize(
    "texto, esperados, de_trazas",
    [
        ("puede contener maní", [], ["mani"]),
        ("Puede contener trazas de leche y soya", [], ["lacteos", "soya"]),
        ("contiene trazas de frutos secos", [], ["frutos_secos"]),
        ("elaborado en una línea que procesa sésamo y huevo",
         [], ["huevo", "sesamo"]),
        ("Elaborado en planta que también procesa trigo", [], ["gluten"]),
        ("may contain nuts", [], ["frutos_secos"]),
        ("contiene leche. puede contener avellanas",
         ["lacteos"], ["frutos_secos"]),
        ("contiene: leche, soya", ["lacteos", "soya"], []),
        ("elaborado con trigo", ["gluten"], []),
    ],
)
def test_trazas(texto, esperados, de_trazas):
    assert alergenos(texto) == esperados
    assert trazas(texto) == de_trazas


def test_detectar_en_lista_revisa_subingredientes_y_declaraciones():
    lista = analizar_ingredientes(
        "Chocolate (azúcar, manteca de cacao, leche en polvo), harina de "
        "arroz, aceite vegetal. Puede contener maní. Sin gluten."
    )
    deteccion = detectar_alergenos(lista)
    assert [a.value for a in deteccion.alergenos] == ["lacteos"]
    assert [t.value for t in deteccion.trazas] == ["mani"]


def test_la_negacion_no_se_extiende_al_ingrediente_vecino():
    lista = analizar_ingredientes("Harina sin gluten, trigo")
    assert [a.value for a in detectar_alergenos(lista).alergenos] == [
        "gluten"
    ]


@pytest.mark.parametrize(
    "texto, esperados",
    [
        ("Azúcar, cacao*. *Contiene leche.", ["lacteos"]),
        ("Azúcar, cacao*. *Elaborado con trigo.", ["gluten"]),
    ],
)
def test_notas_al_pie_se_revisan(texto, esperados):
    lista = analizar_ingredientes(texto)
    assert [i.texto for i in lista.ingredientes] == ["azúcar", "cacao"]
    assert [a.value for a in detectar_alergenos(lista).alergenos] == (
        esperados
    )


@pytest.mark.parametrize(
    "texto, esperado",
    [
        # El nombre de un sabor describe el sabor, no agrega leche.
        ("sabor leche (saborizante natural)", []),
        ("sabor a leche", []),
        ("Sabor leche y crema (saborizantes naturales)", []),
        ("sabor a mantequilla", []),
        ("sabor manjar", []),
        ("natural milk flavour", []),
        ("milk and cream flavors", []),
        # Lo que no es solo el nombre del sabor se sigue marcando.
        ("leche sabor frutilla", ["lacteos"]),
        ("leche con sabor a vainilla", ["lacteos"]),
        ("sabor vainilla y leche", ["lacteos"]),
        ("sabor leche, leche en polvo", ["lacteos"]),
        ("sabor queso", ["lacteos"]),
        ("sabor yogurt", ["lacteos"]),
        ("saborizante de leche", ["lacteos"]),
        ("sabor a maní", ["mani"]),
    ],
)
def test_nombres_de_sabor(texto, esperado):
    assert alergenos(texto) == esperado


@pytest.mark.parametrize(
    "texto, esperado",
    [
        # Marcas con "milk" o "leche" dentro del texto de ingredientes.
        ("Not Milk", []),
        ("bebida vegetal Not Milk (agua, proteína de arveja)", []),
        ("NotMilk", []),
        ("Lechera", []),
        ("Milkaut", []),
        # La marca no tapa la leche declarada en el mismo texto.
        ("bebida Not Milk, leche descremada", ["lacteos"]),
        ("milk chocolate", ["lacteos"]),
    ],
)
def test_marcas_en_el_texto(texto, esperado):
    assert alergenos(texto) == esperado


def test_not_milk_real_de_la_cache_sin_lacteos():
    # 7804659650363: OFF no declara leche; el texto solo la nombra como
    # sabor.
    lista = analizar_ingredientes(
        "Agua, manteca de coco, proteína de arveja, fibra de achicoria, "
        "azúcar, jugo concentrado de piña, aceite de girasol, fosfato "
        "dipotásico (regulador de acidez), carbonato de calcio (regulador "
        "de acidez), sabor leche (saborizante natural), goma de acacia "
        "(espesante), goma gelán (espesante), sal, jugo concentrado de "
        "repollo, vitamina Dy vitamina B12 (nutrientes)."
    )
    assert detectar_alergenos(lista).alergenos == ()


def test_texto_real_en_mayusculas_y_mezclado_con_ingles():
    lista = analizar_ingredientes(
        "INGREDIENTES: HARINA DE TRIGO, AZUCAR, GRASA VEGETAL, CACAO, "
        "Whey powder, EMULSIFIER (SOY LECITHIN), sal. MAY CONTAIN "
        "PEANUTS AND TREE NUTS."
    )
    deteccion = detectar_alergenos(lista)
    assert [a.value for a in deteccion.alergenos] == [
        "lacteos", "gluten", "soya"
    ]
    assert [t.value for t in deteccion.trazas] == ["mani", "frutos_secos"]


@pytest.mark.parametrize(
    "texto, alergenos_esperados, posibles",
    [
        # E322 sin origen: no se marca soya, pero queda como posible.
        ("Azúcar, emulsionante (E322), sal", [], ["soya"]),
        ("Azúcar, emulsionante (INS 322), sal", [], ["soya"]),
        ("Azúcar, emulsionante: E-322", [], ["soya"]),
        # Con origen declarado no es un indicio de soya.
        ("Azúcar, lecitina de girasol (E322)", [], []),
        ("Azúcar, emulsionante (lecitina de girasol, INS 322)", [], []),
        # Si la soya ya se detectó, no hace falta el posible.
        ("Azúcar, emulsionante (lecitina de soya, E322)", ["soya"], []),
        ("Azúcar, lecitina (E322)", ["soya"], []),
        ("Azúcar, sal", [], []),
    ],
)
def test_e322_sin_origen_es_alergeno_posible(texto, alergenos_esperados,
                                             posibles):
    deteccion = detectar_alergenos(analizar_ingredientes(texto))
    assert [a.value for a in deteccion.alergenos] == alergenos_esperados
    assert [p.value for p in deteccion.posibles] == posibles


@pytest.mark.parametrize(
    "etiqueta, esperado",
    [
        ("es:avellanas", ["frutos_secos"]),
        ("es:nueces", ["frutos_secos"]),
        ("es:leche", ["lacteos"]),
        ("es:soja", ["soya"]),
        ("es:frutos-de-cascara", ["frutos_secos"]),
        ("fr:lait", []),
        ("en:none", []),
    ],
)
def test_alergenos_en_etiqueta(etiqueta, esperado):
    assert [a.value for a in alergenos_en_etiqueta(etiqueta)] == esperado
