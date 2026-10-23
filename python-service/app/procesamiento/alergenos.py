"""Detección de alérgenos y trazas en el texto de ingredientes.

Se busca por palabras completas y frases sobre el texto normalizado. Ante
la duda se marca: un falso negativo es mucho más grave que un falso
positivo, así que solo se descartan los casos claros (EXCEPCIONES, nombres
de sabores como "sabor leche" y negaciones como "sin gluten", "libre de
lactosa" o la marca "Not Milk").

Solo se revisa el texto de ingredientes: el nombre y la marca del producto
nunca se pasan a estas funciones.
"""
import re
from dataclasses import dataclass
from typing import Iterable, List, Optional, Pattern, Set, Tuple

from app.procesamiento.ingredientes import ListaIngredientes
from app.procesamiento.sinonimos_alergenos import (
    EXCEPCIONES,
    FRASES_TRAZAS,
    POSIBLES,
    SABORES,
    SINONIMOS,
)
from app.procesamiento.texto import normalizar
from app.schemas.enums import AllergenCode

Tramo = Tuple[int, int]


def _patron(frases: Iterable[str]) -> Optional[Pattern[str]]:
    """Regex de palabras completas que encuentra también coincidencias
    superpuestas (el lookahead no consume texto)."""
    normalizadas = sorted({normalizar(f) for f in frases} - {""},
                          key=len, reverse=True)
    if not normalizadas:
        return None
    alternativas = "|".join(re.escape(f) for f in normalizadas)
    return re.compile(rf"(?=((?<![a-z0-9])(?:{alternativas})(?![a-z0-9])))")


def _patron_sabor(terminos: Iterable[str]) -> Optional[Pattern[str]]:
    """Regex del nombre de un sabor, con varios términos coordinados:
    "sabor a leche y crema", "milk and cream flavour"."""
    normalizados = sorted({normalizar(t) for t in terminos} - {""},
                          key=len, reverse=True)
    if not normalizados:
        return None
    termino = "(?:" + "|".join(re.escape(t) for t in normalizados) + ")"
    varios = rf"{termino}(?: (?:y|e|and) {termino})*"
    # "sabores" y "flavors" ya quedaron en singular; "flavour" no.
    return re.compile(
        rf"(?=((?<![a-z0-9])(?:sabor(?: a)? {varios}|{varios} "
        rf"flavou?rs?)(?![a-z0-9])))"
    )


_TERMINOS = {codigo: _patron(SINONIMOS[codigo]) for codigo in AllergenCode}
_EXCEPCIONES = {
    codigo: _patron(EXCEPCIONES.get(codigo, ())) for codigo in AllergenCode
}
_SABORES = {
    codigo: _patron_sabor(SABORES.get(codigo, ())) for codigo in AllergenCode
}
_POSIBLES = {codigo: _patron(frases) for codigo, frases in POSIBLES.items()}
_TRAZAS = _patron(FRASES_TRAZAS)
# Sobre texto normalizado: "libres" ya quedó como "libre". "not" cubre
# marcas como "Not Milk" cuando aparecen en el texto de ingredientes.
_NEGACION_PREVIA = re.compile(
    r"(?:^|\s)(?:sin|ni|libre de|exento de|exenta de|no contiene|"
    r"no contienen|free from|free of|not)(?: traza de)?\s$"
)
_NEGACION_POSTERIOR = re.compile(r"^\sfree\b")


@dataclass(frozen=True)
class Deteccion:
    alergenos: Tuple[AllergenCode, ...] = ()
    trazas: Tuple[AllergenCode, ...] = ()
    # Indicios sin confirmar (E322 sin origen); no van a alergenos.
    posibles: Tuple[AllergenCode, ...] = ()


def detectar_en_texto(texto: str) -> Deteccion:
    """Alérgenos de un fragmento; lo que sigue a "puede contener",
    "trazas de", "elaborado en una línea que...", etc. va a trazas."""
    plano = normalizar(texto)
    traza = _TRAZAS.search(plano)
    corte = traza.start(1) if traza else len(plano)
    alergenos: Set[AllergenCode] = set()
    trazas: Set[AllergenCode] = set()
    for codigo, inicio in _coincidencias(plano):
        (trazas if inicio >= corte else alergenos).add(codigo)
    return Deteccion(_ordenar(alergenos), _ordenar(trazas))


def detectar_alergenos(lista: ListaIngredientes) -> Deteccion:
    """Revisa cada ingrediente y subingrediente por separado (así una
    negación o excepción no se extiende al vecino) y las declaraciones."""
    alergenos: Set[AllergenCode] = set()
    trazas: Set[AllergenCode] = set()
    for texto in (*lista.fragmentos(), *lista.declaraciones):
        deteccion = detectar_en_texto(texto)
        alergenos.update(deteccion.alergenos)
        trazas.update(deteccion.trazas)
    # Los indicios se revisan con el ingrediente completo, subingredientes
    # incluidos, para ver si declara su origen: "lecitina de girasol (E322)".
    posibles: Set[AllergenCode] = set()
    textos = [i.texto for i in lista.ingredientes]
    for texto in (*textos, *lista.declaraciones):
        posibles.update(_posibles(normalizar(texto)))
    return Deteccion(_ordenar(alergenos), _ordenar(trazas),
                     _ordenar(posibles - alergenos))


def alergenos_en_etiqueta(etiqueta: str) -> List[AllergenCode]:
    """Resuelve una etiqueta de OFF fuera de la taxonomía, como
    "es:avellanas" -> frutos_secos. Vacía si no se reconoce."""
    valor = etiqueta.split(":", 1)[-1]
    codigos = {codigo for codigo, _ in _coincidencias(normalizar(valor))}
    return list(_ordenar(codigos))


def _coincidencias(plano: str) -> List[Tuple[AllergenCode, int]]:
    """(código, posición) de cada sinónimo que no está negado ni dentro de
    una excepción o del nombre de un sabor."""
    encontradas: List[Tuple[AllergenCode, int]] = []
    for codigo in AllergenCode:
        tramos = _tramos(_TERMINOS[codigo], plano)
        if not tramos:
            continue
        # Un tramo negado descarta también lo que contiene: en "sin harina
        # de trigo" se descarta "trigo", no solo "harina de trigo".
        descartados = [t for t in tramos if _negado(plano, t)]
        descartados += _tramos(_EXCEPCIONES[codigo], plano)
        descartados += _tramos(_SABORES[codigo], plano)
        encontradas.extend(
            (codigo, inicio) for inicio, fin in tramos
            if not any(a <= inicio and fin <= b for a, b in descartados)
        )
    return encontradas


def _posibles(plano: str) -> Set[AllergenCode]:
    return {
        codigo for codigo, patron in _POSIBLES.items()
        if _tramos(patron, plano)
        and not _tramos(_EXCEPCIONES[codigo], plano)
    }


def _tramos(patron: Optional[Pattern[str]], plano: str) -> List[Tramo]:
    if patron is None:
        return []
    return [(m.start(1), m.end(1)) for m in patron.finditer(plano)]


def _negado(plano: str, tramo: Tramo) -> bool:
    inicio, fin = tramo
    return bool(_NEGACION_PREVIA.search(plano[:inicio])
                or _NEGACION_POSTERIOR.match(plano[fin:]))


def _ordenar(codigos: Iterable[AllergenCode]) -> Tuple[AllergenCode, ...]:
    presentes = set(codigos)
    return tuple(c for c in AllergenCode if c in presentes)
