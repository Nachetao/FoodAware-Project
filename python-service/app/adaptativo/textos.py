"""Nombres legibles y frases de los veredictos y del resumen de no aptos."""
from collections import Counter
from typing import Iterable, List, Optional, Tuple, Union

from app.schemas.adaptativo import ConteoMotivo, MotivoNoApto
from app.schemas.enums import AllergenCode, DietLabel

NOMBRES_ALERGENOS = {
    AllergenCode.lacteos: "lácteos",
    AllergenCode.gluten: "gluten",
    AllergenCode.huevo: "huevo",
    AllergenCode.mani: "maní",
    AllergenCode.frutos_secos: "frutos secos",
    AllergenCode.soya: "soya",
    AllergenCode.pescado: "pescado",
    AllergenCode.crustaceos: "crustáceos",
    AllergenCode.moluscos: "moluscos",
    AllergenCode.sesamo: "sésamo",
    AllergenCode.mostaza: "mostaza",
    AllergenCode.apio: "apio",
    AllergenCode.sulfitos: "sulfitos",
    AllergenCode.altramuces: "altramuces",
}

NOMBRES_DIETAS = {
    DietLabel.vegano: "vegana",
    DietLabel.vegetariano: "vegetariana",
    DietLabel.sin_gluten: "sin gluten",
    DietLabel.sin_lactosa: "sin lactosa",
}

Codigo = Optional[Union[AllergenCode, DietLabel]]


def nombre(codigo: Union[AllergenCode, DietLabel]) -> str:
    if isinstance(codigo, AllergenCode):
        return NOMBRES_ALERGENOS[codigo]
    return NOMBRES_DIETAS[codigo]


def enumerar(nombres: Iterable[str]) -> str:
    """"a", "a y b", "a, b y c"."""
    nombres = list(nombres)
    if len(nombres) <= 1:
        return "".join(nombres)
    return ", ".join(nombres[:-1]) + " y " + nombres[-1]


def frase_motivo(tipo: str, codigo: Codigo) -> str:
    """"por contener lácteos", "por poder contener maní"..."""
    if tipo == "datos_insuficientes":
        return "por datos insuficientes"
    if tipo == "dieta":
        return f"por no cumplir la dieta {nombre(codigo)}"
    if tipo == "traza":
        return f"por poder contener {nombre(codigo)}"
    if tipo == "posible":
        return f"por un posible indicio de {nombre(codigo)}"
    return f"por contener {nombre(codigo)}"


def contar_motivos(
    motivos_por_producto: Iterable[List[MotivoNoApto]],
) -> List[ConteoMotivo]:
    """Cuántos productos tienen cada motivo, del más frecuente al menos.
    Un producto con dos motivos cuenta en los dos."""
    conteo: Counter = Counter()
    for motivos in motivos_por_producto:
        conteo.update({(m.tipo, m.codigo) for m in motivos})
    ordenados: List[Tuple[Tuple[str, Codigo], int]] = sorted(
        conteo.items(),
        key=lambda item: (-item[1], item[0][0],
                          item[0][1].value if item[0][1] else ""),
    )
    return [ConteoMotivo(tipo=tipo, codigo=codigo, cantidad=cantidad)
            for (tipo, codigo), cantidad in ordenados]


def texto_no_aptos(total: int, ocultos: bool,
                   motivos: List[ConteoMotivo]) -> str:
    """"25 ocultos por contener lácteos." o
    "3 no aptos al final del ranking: 2 por contener lácteos y 1 por
    poder contener maní.\""""
    if total == 0:
        return "Ningún producto es no apto para este perfil."
    if ocultos:
        cabeza = f"{total} {'oculto' if total == 1 else 'ocultos'}"
    else:
        cabeza = (f"{total} {'no apto' if total == 1 else 'no aptos'} "
                  "al final del ranking")
    if len(motivos) == 1 and motivos[0].cantidad == total:
        return f"{cabeza} {frase_motivo(motivos[0].tipo, motivos[0].codigo)}."
    detalle = enumerar(f"{m.cantidad} {frase_motivo(m.tipo, m.codigo)}"
                       for m in motivos)
    return f"{cabeza}: {detalle}."
