"""Restricciones escritas en la consulta ("chocolate sin leche")."""
import pytest

from app.adaptativo.consulta import interpretar
from app.schemas.adaptativo import PerfilRestricciones


def resumen(consulta):
    interpretada = interpretar(consulta)
    return (interpretada.texto_busqueda,
            [(r.texto, r.tipo, r.codigo.value)
             for r in interpretada.restricciones],
            interpretada.no_reconocidas)


@pytest.mark.parametrize("consulta, esperado", [
    ("chocolate sin leche",
     ("chocolate", [("sin leche", "alergeno", "lacteos")], [])),
    ("galletas sin gluten",
     ("galletas", [("sin gluten", "alergeno", "gluten")], [])),
    ("snack sin maní",
     ("snack", [("sin maní", "alergeno", "mani")], [])),
    ("Snack SIN MANI",
     ("Snack", [("SIN MANI", "alergeno", "mani")], [])),
    ("galletas libre de gluten",
     ("galletas", [("libre de gluten", "alergeno", "gluten")], [])),
    ("galletas libres de huevo",
     ("galletas", [("libres de huevo", "alergeno", "huevo")], [])),
    ("pan que no contiene soya",
     ("pan que", [("no contiene soya", "alergeno", "soya")], [])),
    ("barra sin frutos secos",
     ("barra", [("sin frutos secos", "alergeno", "frutos_secos")], [])),
    ("galletas sin leche ni huevo",
     ("galletas", [("sin leche", "alergeno", "lacteos"),
                   ("ni huevo", "alergeno", "huevo")], [])),
    ("galletas sin leche y sin maní",
     ("galletas", [("sin leche", "alergeno", "lacteos"),
                   ("sin maní", "alergeno", "mani")], [])),
    ("chocolate sin trazas de maní",
     ("chocolate", [("sin trazas de maní", "alergeno", "mani")], [])),
    # "sin lactosa" es la dieta, no la alergia a lácteos.
    ("leche sin lactosa",
     ("leche", [("sin lactosa", "dieta", "sin_lactosa")], [])),
    # "Marisco" puede ser crustáceo o molusco: se excluyen los dos.
    ("empanada sin marisco",
     ("empanada", [("sin marisco", "alergeno", "crustaceos"),
                   ("sin marisco", "alergeno", "moluscos")], [])),
    ("galletas sin azúcar",
     ("galletas sin azúcar", [], ["sin azúcar"])),
    ("galletas sin azúcar sin gluten",
     ("galletas sin azúcar", [("sin gluten", "alergeno", "gluten")],
      ["sin azúcar"])),
    ("leche con chocolate", ("leche con chocolate", [], [])),
    ("chocolate sin", ("chocolate sin", [], [])),
    ("sin gluten", ("", [("sin gluten", "alergeno", "gluten")], [])),
    ("chocolate sin leche, avellana",
     ("chocolate avellana", [("sin leche", "alergeno", "lacteos")], [])),
])
def test_interpreta_la_consulta(consulta, esperado):
    assert resumen(consulta) == esperado


def test_un_alergeno_repetido_cuenta_una_vez():
    interpretada = interpretar("galletas sin leche sin lácteos")

    assert [r.codigo.value for r in interpretada.restricciones] == ["lacteos"]


def test_suma_las_restricciones_al_perfil_sin_repetir():
    interpretada = interpretar("galletas sin leche ni maní sin lactosa")
    perfil = PerfilRestricciones(alergias=["mani", "soya"],
                                 dietas=["vegano"], modo_estricto=True)

    aplicado = interpretada.aplicar(perfil)

    assert aplicado.alergias == ["mani", "soya", "lacteos"]
    assert aplicado.dietas == ["vegano", "sin_lactosa"]
    assert aplicado.modo_estricto is True
    # El perfil recibido no cambia.
    assert perfil.alergias == ["mani", "soya"]
