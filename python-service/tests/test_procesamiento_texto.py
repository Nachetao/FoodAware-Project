import pytest

from app.procesamiento.texto import (
    SINONIMOS,
    STOPWORDS,
    canonica,
    normalizar,
    sin_tildes,
    singular,
    tokenizar,
)


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Maní", "Mani"),
        ("azúcar, jamón y piñones", "azucar, jamon y pinones"),
        ("CAFÉ", "CAFE"),
        ("pingüino", "pinguino"),
        ("sin tildes", "sin tildes"),
    ],
)
def test_sin_tildes(texto, esperado):
    assert sin_tildes(texto) == esperado


@pytest.mark.parametrize(
    "palabra, esperado",
    [
        ("almendras", "almendra"),
        ("huevos", "huevo"),
        ("aceites", "aceite"),
        ("nueces", "nuez"),
        ("altramuces", "altramuz"),
        ("cereales", "cereal"),
        ("azucares", "azucar"),
        ("camarones", "camaron"),
        ("mejillones", "mejillon"),
        ("calamares", "calamar"),
        ("lacteos", "lacteo"),
        ("cacahuetes", "cacahuete"),
        ("pinones", "pinon"),
        # No se tocan: singulares, palabras cortas o invariables.
        ("leche", "leche"),
        ("sal", "sal"),
        ("gas", "gas"),
        ("anis", "anis"),
        ("pais", "pais"),
        ("humus", "humus"),
        ("tres", "tres"),
        ("menos", "menos"),
    ],
)
def test_singular_basico(palabra, esperado):
    assert singular(palabra) == esperado


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Leche Entera", "leche entera"),
        ("  NUECES   Pecanas ", "nuez pecana"),
        ("Maní tostado.", "mani tostado"),
        ("Lecitina de Soya (E-322)", "lecitina de soya e322"),
        ("metabisulfito de sodio (INS 223)", "metabisulfito de sodio e223"),
        ("conservante E220", "conservante e220"),
        ("vitamina D3", "vitamina d3"),
        ("Castaña de Cajú", "castana de caju"),
        ("", ""),
    ],
)
def test_normalizar(texto, esperado):
    assert normalizar(texto) == esperado


def test_normalizar_sin_singular():
    assert normalizar("Almendras Tostadas", singularizar=False) == (
        "almendras tostadas"
    )


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Leche de Almendras SIN azúcar",
         ["leche", "almendra", "sin", "azucar"]),
        ("Galletas con chips de chocolate",
         ["galleta", "chips", "chocolate"]),
        ("The cookies with NUECES y maní", ["galleta", "nuez", "mani"]),
        ("Pan de molde integral (680 g)",
         ["pan", "molde", "integral", "680"]),
        ("Vitamina D3", ["vitamina", "d3"]),
        ("Yogur sabor frutilla, 1 L", ["yogurt", "sabor", "frutilla", "1"]),
        ("de la y el", []),
        ("", []),
    ],
)
def test_tokenizar(texto, esperado):
    assert tokenizar(texto) == esperado


def test_stopwords_estan_normalizadas():
    assert all(p == normalizar(p, singularizar=False) for p in STOPWORDS)
    # La negación cambia el sentido de la búsqueda; no es stopword.
    assert "sin" not in STOPWORDS


# --- Sinónimos de vocabulario ----------------------------------------------


@pytest.mark.parametrize(
    "variantes, canonico",
    [
        (["soja", "Soya", "SOY", "soybeans"], "soya"),
        (["maní", "cacahuete", "Cacahuates", "peanuts"], "mani"),
        (["yogur", "Yoghurt", "yogures", "yogurt"], "yogurt"),
        (["galletita", "galletitas", "biscuits", "cookies"], "galleta"),
        (["fresa", "Fresas", "strawberries", "frutilla"], "frutilla"),
        (["patata", "potatoes", "papas"], "papa"),
        (["almonds", "almendras"], "almendra"),
        (["snacks", "snack"], "snack"),
    ],
)
def test_variantes_dan_el_mismo_token(variantes, canonico):
    assert {t for v in variantes for t in tokenizar(v)} == {canonico}


def test_indexar_y_consultar_dan_los_mismos_terminos():
    # Un nombre del corpus y la consulta que lo busca, con otras palabras.
    assert tokenizar("Bebida de Soja sabor Vainilla") == tokenizar(
        "bebida soya sabor vanilla"
    )
    assert tokenizar("Yoghurt Batido Natural") == ["yogurt", "batido",
                                                   "natural"]


def test_sinonimos_bien_formados():
    # Las claves y los valores ya están en la forma que produce tokenizar,
    # así se aplican tal cual.
    for variante, forma in SINONIMOS.items():
        assert variante != forma
        assert singular(normalizar(variante, singularizar=False)) == variante
        assert singular(normalizar(forma, singularizar=False)) == forma
    # Sin cadenas: una forma canónica no es a su vez una variante.
    assert not set(SINONIMOS.values()) & set(SINONIMOS)


def test_canonica_deja_igual_lo_que_no_es_sinonimo():
    assert canonica("avena") == "avena"
    assert canonica("soja") == "soya"


def test_los_sinonimos_no_tocan_normalizar():
    # normalizar() se usa para detectar alérgenos y duplicados: no cambia.
    assert normalizar("Bebida de soja") == "bebida de soja"
