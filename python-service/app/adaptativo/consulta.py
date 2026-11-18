"""Restricciones escritas en la consulta: "chocolate sin leche".

Reconoce "sin X", "libre de X" y "no contiene X" (y "ni X", "y X" u "o X"
justo después: "sin leche ni huevo"), donde X es un sinónimo de alérgeno del
mismo diccionario que usa la detección en los ingredientes. Esas frases se
sacan del texto que se busca con BM25 y sus alérgenos se suman al perfil solo
para esa búsqueda. Así "chocolate sin leche" busca "chocolate" y excluye los
lácteos, en vez de premiar justo los productos con leche.

"sin lactosa" es la dieta sin_lactosa, no la alergia a lácteos: un producto
deslactosado lleva lácteos y sirve a quien es intolerante a la lactosa.
Lo que sigue a un "sin" y no es un alérgeno ("sin azúcar") se deja en la
consulta y se informa como no reconocido.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple, Union

from app.procesamiento.sinonimos_alergenos import SINONIMOS
from app.procesamiento.texto import normalizar
from app.schemas.adaptativo import (
    PerfilRestricciones,
    RestriccionConsulta,
)
from app.schemas.enums import AllergenCode, DietLabel

# Formas normalizadas (minúsculas, sin tildes, singular) de cada disparador.
_DISPARADORES: Tuple[Tuple[str, ...], ...] = (
    ("libre", "de"),
    ("no", "contiene"),
    ("no", "contienen"),
    ("sin",),
)
_CONECTORES = frozenset({"ni", "y", "o"})

Codigo = Union[AllergenCode, DietLabel]


def _diccionario() -> Dict[Tuple[str, ...], Tuple[Codigo, ...]]:
    """Frase normalizada -> códigos. "marisco" da crustáceos y moluscos."""
    frases: Dict[Tuple[str, ...], Set[Codigo]] = {}
    for codigo, sinonimos in SINONIMOS.items():
        for sinonimo in sinonimos:
            palabras = tuple(normalizar(sinonimo).split())
            if palabras:
                frases.setdefault(palabras, set()).add(codigo)
    # En una consulta, "sin lactosa" es la dieta, no la alergia.
    frases[("lactosa",)] = {DietLabel.sin_lactosa}
    return {
        frase: tuple(sorted(codigos, key=lambda c: c.value))
        for frase, codigos in frases.items()
    }


_FRASES = _diccionario()
_LARGO_MAXIMO = max(len(frase) for frase in _FRASES)


@dataclass(frozen=True)
class ConsultaInterpretada:
    # Texto que se busca con BM25 (la consulta sin las restricciones).
    texto_busqueda: str
    restricciones: List[RestriccionConsulta] = field(default_factory=list)
    no_reconocidas: List[str] = field(default_factory=list)

    def aplicar(self, perfil: PerfilRestricciones) -> PerfilRestricciones:
        """El perfil más las restricciones de la consulta, sin repetir."""
        alergias = list(perfil.alergias)
        dietas = list(perfil.dietas)
        for restriccion in self.restricciones:
            destino = alergias if restriccion.tipo == "alergeno" else dietas
            if restriccion.codigo not in destino:
                destino.append(restriccion.codigo)
        return PerfilRestricciones(alergias=alergias, dietas=dietas,
                                   modo_estricto=perfil.modo_estricto)


def interpretar(consulta: str) -> ConsultaInterpretada:
    palabras = consulta.split()
    # Una palabra puede normalizarse a nada (solo puntuación) o a varias
    # ("e-220" queda "e220"; "leche," queda "leche").
    normales = [normalizar(p) for p in palabras]
    usadas: Set[int] = set()
    restricciones: List[RestriccionConsulta] = []
    no_reconocidas: List[str] = []

    i = 0
    while i < len(palabras):
        largo_disparador = _disparador(normales, i)
        if not largo_disparador:
            i += 1
            continue
        inicio = i
        j = i + largo_disparador
        encontrada = _frase_con_relleno(normales, j)
        if encontrada is None:
            # "sin azúcar": queda en la consulta y se informa.
            if j < len(palabras):
                no_reconocidas.append(" ".join(palabras[inicio:j + 1]))
            i = j
            continue
        while encontrada is not None:
            largo_frase, codigos = encontrada
            fin = j + largo_frase
            texto = " ".join(palabras[inicio:fin]).rstrip(",;.")
            restricciones += [_restriccion(texto, c) for c in codigos]
            usadas.update(range(inicio, fin))
            # "ni huevo", "y maní" o "o soya" encadenan otra restricción.
            if fin < len(palabras) and normales[fin] in _CONECTORES:
                siguiente = _frase_con_relleno(normales, fin + 1)
                if siguiente is not None:
                    inicio, j, encontrada = fin, fin + 1, siguiente
                    continue
                # "sin leche y sin maní": el conector tampoco se busca.
                if _disparador(normales, fin + 1):
                    usadas.add(fin)
            encontrada = None
            i = fin

    texto_busqueda = " ".join(
        p.rstrip(",;") for k, p in enumerate(palabras) if k not in usadas
    ).strip()
    return ConsultaInterpretada(
        texto_busqueda=texto_busqueda,
        restricciones=_sin_repetir(restricciones),
        no_reconocidas=no_reconocidas,
    )


def _disparador(normales: List[str], i: int) -> int:
    """Cuántas palabras ocupa el disparador que empieza en i (0 si no hay)."""
    for disparador in _DISPARADORES:
        fin = i + len(disparador)
        if tuple(normales[i:fin]) == disparador:
            return len(disparador)
    return 0


def _frase_con_relleno(
    normales: List[str], j: int,
) -> Optional[Tuple[int, Tuple[Codigo, ...]]]:
    """Como _frase, pero acepta "trazas de" antes del sinónimo ("sin
    trazas de maní"); el largo incluye esas palabras."""
    encontrada = _frase(normales, j)
    if encontrada is not None or j >= len(normales):
        return encontrada
    salto = 0
    if normales[j] == "traza":
        salto = 2 if j + 1 < len(normales) and normales[j + 1] == "de" else 1
    if not salto:
        return None
    despues = _frase(normales, j + salto)
    if despues is None:
        return None
    return despues[0] + salto, despues[1]


def _frase(normales: List[str],
           j: int) -> Optional[Tuple[int, Tuple[Codigo, ...]]]:
    """(palabras que ocupa, códigos) del sinónimo más largo que empieza en
    j, o None."""
    for largo in range(min(_LARGO_MAXIMO, len(normales) - j), 0, -1):
        palabras = tuple(" ".join(normales[j:j + largo]).split())
        if palabras in _FRASES:
            return largo, _FRASES[palabras]
    return None


def _restriccion(texto: str, codigo: Codigo) -> RestriccionConsulta:
    tipo = "alergeno" if isinstance(codigo, AllergenCode) else "dieta"
    return RestriccionConsulta(texto=texto, tipo=tipo, codigo=codigo)


def _sin_repetir(
    restricciones: List[RestriccionConsulta],
) -> List[RestriccionConsulta]:
    vistos: Set[Tuple[str, Codigo]] = set()
    unicas = []
    for restriccion in restricciones:
        clave = (restriccion.tipo, restriccion.codigo)
        if clave not in vistos:
            vistos.add(clave)
            unicas.append(restriccion)
    return unicas
