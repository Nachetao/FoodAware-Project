import pytest

from app.procesamiento.texto import (
    STOPWORDS,
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
        ("The cookies with NUECES y maní", ["cookie", "nuez", "mani"]),
        ("Pan de molde integral (680 g)",
         ["pan", "molde", "integral", "680"]),
        ("Vitamina D3", ["vitamina", "d3"]),
        ("Yogur sabor frutilla, 1 L", ["yogur", "sabor", "frutilla", "1"]),
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
