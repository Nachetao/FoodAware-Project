import pytest

from app.procesamiento.ingredientes import (
    Ingrediente,
    analizar_ingredientes,
    limpiar_texto_ingredientes,
    separar_ingredientes,
)


@pytest.mark.parametrize(
    "texto, esperado",
    [
        (None, []),
        ("", []),
        ("   ", []),
        ("Ingredientes:", []),
        ("Agua, sal.", ["agua", "sal"]),
        ("Chocolate (azúcar, cacao), leche; sal",
         ["chocolate (azúcar, cacao)", "leche", "sal"]),
        ("_Leche_ entera,  _LECHE_ entera , sal", ["leche entera", "sal"]),
        # Leche chocolatada, todo en mayúsculas y con porcentaje.
        ("INGREDIENTES: LECHE ENTERA, AZÚCAR, CACAO EN POLVO (2%), "
         "ESTABILIZANTES (CARRAGENINA, GOMA GUAR), SAL.",
         ["leche entera", "azúcar", "cacao en polvo",
          "estabilizantes (carragenina, goma guar)", "sal"]),
        # Porcentajes en todas sus formas.
        ("Leche (30 %), crema 15,5 %, azúcar (min. 10%), cacao (mínimo 2%), "
         "sal (menos de 1%), manjar 12.5%",
         ["leche", "crema", "azúcar", "cacao", "sal", "manjar"]),
        # Puntuación sobrante y espacios mal puestos.
        ("leche descremada ,azucar,, cacao ;  sal . ",
         ["leche descremada", "azucar", "cacao", "sal"]),
        ("Harina de\ntrigo,\n\nazúcar ,,; sal...",
         ["harina de trigo", "azúcar", "sal"]),
        # Inglés mezclado con español.
        ("Ingredients: WHEAT FLOUR, sugar, LECHE EN POLVO, cocoa butter",
         ["wheat flour", "sugar", "leche en polvo", "cocoa butter"]),
        # Pan amasado.
        ("HARINA DE TRIGO, AGUA, MANTECA, SAL, LEVADURA.",
         ["harina de trigo", "agua", "manteca", "sal", "levadura"]),
        # Conjunción al inicio y repetidos.
        ("sal, azúcar y canela, y sal", ["sal", "azúcar y canela"]),
        # Viñetas.
        ("Leche • azúcar • cacao", ["leche", "azúcar", "cacao"]),
        # Abreviaturas que no cortan la oración.
        ("Leche, vit. C, vit. D3, azúcar.",
         ["leche", "vit. c", "vit. d3", "azúcar"]),
        # Números con coma que no se separan.
        ("Aceite vegetal (omega 3,6,9), sal",
         ["aceite vegetal (omega 3,6,9)", "sal"]),
        ("Conservante (E-220), agua", ["conservante (e-220)", "agua"]),
    ],
)
def test_separar_ingredientes(texto, esperado):
    assert separar_ingredientes(texto) == esperado


def test_galletas_chilenas_con_trazas():
    lista = analizar_ingredientes(
        "Harina de _trigo_ fortificada (hierro, niacina, tiamina, "
        "riboflavina, ácido fólico), azúcar, grasa vegetal (palma), cacao "
        "4,5%, jarabe de glucosa, sal, leudantes (bicarbonato de sodio, "
        "bicarbonato de amonio), emulsionante (lecitina de _soya_), "
        "saborizante idéntico a natural. Puede contener trazas de _leche_ "
        "y _maní_."
    )
    assert [i.texto for i in lista.ingredientes] == [
        "harina de trigo fortificada (hierro, niacina, tiamina, "
        "riboflavina, ácido fólico)",
        "azúcar",
        "grasa vegetal (palma)",
        "cacao",
        "jarabe de glucosa",
        "sal",
        "leudantes (bicarbonato de sodio, bicarbonato de amonio)",
        "emulsionante (lecitina de soya)",
        "saborizante idéntico a natural",
    ]
    assert lista.declaraciones == ("puede contener trazas de leche y maní",)


def test_subingredientes_anidados_quedan_disponibles():
    lista = analizar_ingredientes(
        "Chocolate de leche (azúcar, manteca de cacao, leche en polvo, "
        "pasta de cacao, emulsionante (lecitina de soya)), almendras"
    )
    chocolate, almendras = lista.ingredientes
    assert chocolate.nombre == "chocolate de leche"
    assert chocolate.texto == (
        "chocolate de leche (azúcar, manteca de cacao, leche en polvo, "
        "pasta de cacao, emulsionante (lecitina de soya))"
    )
    assert almendras == Ingrediente("almendras")
    assert list(lista.fragmentos()) == [
        "chocolate de leche", "azúcar", "manteca de cacao",
        "leche en polvo", "pasta de cacao", "emulsionante",
        "lecitina de soya", "almendras",
    ]


@pytest.mark.parametrize(
    "texto, esperado",
    [
        ("Chocolate (azúcar, cacao, sal", ["chocolate (azúcar, cacao, sal)"]),
        ("azúcar), sal", ["azúcar", "sal"]),
        ("Relleno [azúcar; grasa] , sal",
         ["relleno (azúcar, grasa)", "sal"]),
        ("(leche, azúcar), sal", ["leche", "azúcar", "sal"]),
    ],
)
def test_parentesis_desbalanceados_o_raros(texto, esperado):
    assert separar_ingredientes(texto) == esperado


def test_etiquetas_de_componentes():
    lista = analizar_ingredientes(
        "Galleta: harina de trigo, azúcar, manteca. Relleno: azúcar, grasa "
        "vegetal, suero de leche."
    )
    assert [i.texto for i in lista.ingredientes] == [
        "galleta (harina de trigo, azúcar, manteca)",
        "relleno (azúcar, grasa vegetal, suero de leche)",
    ]


def test_dos_puntos_en_medio_se_conserva():
    assert separar_ingredientes(
        "Harina, emulsionante: lecitina de soja, sal"
    ) == ["harina", "emulsionante: lecitina de soja", "sal"]


def test_nota_al_pie_de_organicos_se_descarta():
    assert separar_ingredientes(
        "Azúcar*, cacao*, leche en polvo*. *Ingredientes de origen orgánico."
    ) == ["azúcar", "cacao", "leche en polvo"]


@pytest.mark.parametrize(
    "texto, ingredientes, declaraciones",
    [
        ("Agua, azúcar, jugo de limón. CONTIENE SULFITOS.",
         ["agua", "azúcar", "jugo de limón"], ("contiene sulfitos",)),
        ("Harina de trigo, azúcar, sal, puede contener trazas de maní, "
         "almendras y soya",
         ["harina de trigo", "azúcar", "sal"],
         ("puede contener trazas de maní, almendras y soya",)),
        ("Harina de arroz, agua, sal. Sin gluten.",
         ["harina de arroz", "agua", "sal"], ("sin gluten",)),
        ("sal.Puede contener maní", ["sal"], ("puede contener maní",)),
        ("Chocolate (azúcar, cacao, puede contener leche), sal",
         ["chocolate (azúcar, cacao)", "sal"], ("puede contener leche",)),
        ("Leche, azúcar. Elaborado en una línea que procesa maní.",
         ["leche", "azúcar"],
         ("elaborado en una línea que procesa maní",)),
        ("Wheat flour, sugar. May contain nuts.",
         ["wheat flour", "sugar"], ("may contain nuts",)),
        ("Puede contener: maní.", [], ("puede contener: maní",)),
    ],
)
def test_declaraciones_no_son_ingredientes(texto, ingredientes,
                                           declaraciones):
    lista = analizar_ingredientes(texto)
    assert [i.texto for i in lista.ingredientes] == ingredientes
    assert lista.declaraciones == declaraciones


def test_contiene_o_menos_de_no_es_declaracion():
    lista = analizar_ingredientes(
        "Harina de trigo, agua, contiene 2% o menos de: sal, levadura, "
        "vinagre."
    )
    assert [i.texto for i in lista.ingredientes] == [
        "harina de trigo", "agua", "sal", "levadura", "vinagre"
    ]
    assert lista.declaraciones == ()


def test_lactobacillus_spp_dentro_de_parentesis():
    assert separar_ingredientes(
        "Ingredientes: Leche (99%), cultivos lácticos (Lactobacillus spp.), "
        "azúcar."
    ) == ["leche", "cultivos lácticos (lactobacillus spp)", "azúcar"]


def test_limpiar_texto_conserva_mayusculas_y_tildes():
    assert limpiar_texto_ingredientes(
        "Ingredientes: _Leche_ (30%), azúcar*.  Puede contener maní."
    ) == "Leche, azúcar. Puede contener maní"
    assert limpiar_texto_ingredientes(None) == ""


def test_ingrediente_normalizado():
    assert Ingrediente("nueces pecanas").normalizado == "nuez pecana"
    assert Ingrediente("Leche en Polvo").normalizado == "leche en polvo"
