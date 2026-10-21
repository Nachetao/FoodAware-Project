"""Limpieza y separación del texto de ingredientes de Open Food Facts.

El resultado separa los ingredientes (con sus subingredientes entre
paréntesis) de las declaraciones que no son ingredientes, como "puede
contener maní" o "sin gluten"; esas quedan aparte para detectar trazas.
"""
import re
from dataclasses import dataclass
from typing import Callable, Iterable, Iterator, List, Optional, Tuple

from app.procesamiento.texto import normalizar

_APERTURAS = "([{"
_CIERRES = ")]}"

_PREFIJO = re.compile(
    r"^\s*(?:lista\s+de\s+)?(?:ingredientes|ingrediente|ingredients|"
    r"ingredient|ingr\.)\s*[:\-–.]\s*",
    re.IGNORECASE,
)
# "Galleta: harina, azúcar." -> "galleta (harina, azúcar)".
_ETIQUETA = re.compile(r"^([^,;:()\[\]{}]{1,40}):\s*(?=\S)")
_MAX_PALABRAS_ETIQUETA = 4

# "Contiene 2% o menos de: sal, ..." enumera ingredientes, no alérgenos.
_MENOS_DE = re.compile(
    r"\b(?:contiene|contains)\s+\d+(?:[.,]\d+)?\s*%\s+(?:o|or)\s+"
    r"(?:menos|less)\s+(?:de|of)\b\s*:?",
    re.IGNORECASE,
)
_CALIFICADOR = (
    r"(?:\b(?:m[ií]n(?:imo)?|m[aá]x(?:imo)?|aprox(?:imadamente)?)\.?\s*"
    r"|\b(?:menos|m[aá]s)\s+de\s+|[<>≤≥]\s*)"
)
_NUMERO_PORCENTAJE = r"\d+(?:[.,]\d+)?\s*%"
_PORCENTAJE_ENTRE_PARENTESIS = re.compile(
    rf"[(\[]\s*{_CALIFICADOR}?{_NUMERO_PORCENTAJE}\s*[)\]]", re.IGNORECASE
)
_PORCENTAJE = re.compile(
    rf"{_CALIFICADOR}?{_NUMERO_PORCENTAJE}", re.IGNORECASE
)
# OFF marca los alérgenos con _guiones bajos_ y lo orgánico con asteriscos.
_MARCAS = re.compile(r"[*_]+")
_VINETAS = re.compile(r"[•·]")
_PARENTESIS_VACIOS = re.compile(r"[(\[{]\s*[)\]}]")
_ESPACIO_ANTES = re.compile(r"\s+([,;:.)\]}])")
_ESPACIO_DESPUES = re.compile(r"([(\[{])\s+")
_SEPARADORES_REPETIDOS = re.compile(r"([,;:])(?:\s*[,;:.])+")
_PUNTOS_REPETIDOS = re.compile(r"\.(?:\s*[.,;])+")
_CONJUNCION_INICIAL = re.compile(r"^(?:y|and)\s+")
_BORDES = " ,;:.-–—/\"'«»"

# Abreviaturas tras las que un punto no termina la oración.
_ABREVIATURAS = frozenset({
    "ac", "aprox", "conc", "ej", "esp", "max", "min", "sp", "spp", "var",
    "vit",
})
_PALABRA_FINAL = re.compile(r"([^\W\d_]+)$")

# Comienzos (normalizados) de frases que no son ingredientes.
_INICIOS_DECLARACION = (
    "puede contener", "pueden contener", "podria contener", "puede tener",
    "puede presentar", "contiene", "contienen", "traza", "trazas",
    "elaborado", "elaborada", "fabricado", "fabricada", "producido",
    "producida", "envasado en", "envasada en", "procesado en",
    "sin", "libre de", "libres de", "exento de", "exenta de",
    "no contiene", "alergeno", "alergenos", "informacion para alergicos",
    "advertencia", "apto para", "este producto",
    "may contain", "may also contain", "contains", "traces",
    "manufactured", "produced", "made in", "made on", "packed in",
    "free from", "gluten free",
)


@dataclass(frozen=True)
class Ingrediente:
    """Ingrediente legible (minúsculas, con tildes) y sus subingredientes."""

    nombre: str
    subingredientes: Tuple["Ingrediente", ...] = ()

    @property
    def texto(self) -> str:
        if not self.subingredientes:
            return self.nombre
        internos = ", ".join(s.texto for s in self.subingredientes)
        return f"{self.nombre} ({internos})"

    @property
    def normalizado(self) -> str:
        return normalizar(self.nombre)

    def fragmentos(self) -> Iterator[str]:
        """Su nombre y los de todos sus subingredientes, en orden."""
        yield self.nombre
        for sub in self.subingredientes:
            yield from sub.fragmentos()


@dataclass(frozen=True)
class ListaIngredientes:
    ingredientes: Tuple[Ingrediente, ...]
    # "puede contener maní", "contiene leche", "sin gluten", ...
    declaraciones: Tuple[str, ...]

    def fragmentos(self) -> Iterator[str]:
        for ingrediente in self.ingredientes:
            yield from ingrediente.fragmentos()


def limpiar_texto_ingredientes(texto: Optional[str]) -> str:
    """Texto sin prefijo, porcentajes, marcas de OFF ni puntuación sobrante.

    Conserva mayúsculas y tildes; separa las oraciones con ". ".
    """
    return ". ".join(oracion for oracion, _ in _oraciones(texto or ""))


def analizar_ingredientes(texto: Optional[str]) -> ListaIngredientes:
    ingredientes: List[Ingrediente] = []
    declaraciones: List[str] = []
    for oracion, es_nota in _oraciones(texto or ""):
        # Una nota al pie ("*Contiene leche") no es un ingrediente, pero se
        # guarda para que la detección de alérgenos también la revise.
        if es_nota or _es_declaracion(oracion):
            declaraciones.append(_limpiar_fragmento(oracion))
            continue
        etiqueta = _ETIQUETA.match(oracion)
        if (etiqueta and len(etiqueta.group(1).split())
                <= _MAX_PALABRAS_ETIQUETA):
            oracion = f"{etiqueta.group(1)} ({oracion[etiqueta.end():]})"
        items, internas = _analizar_lista(oracion)
        ingredientes.extend(items)
        declaraciones.extend(internas)
    return ListaIngredientes(
        ingredientes=tuple(_sin_repetidos(ingredientes)),
        declaraciones=tuple(dict.fromkeys(d for d in declaraciones if d)),
    )


def separar_ingredientes(texto: Optional[str]) -> List[str]:
    """Lista legible para Producto.ingredientes."""
    return [i.texto for i in analizar_ingredientes(texto).ingredientes]


def _oraciones(texto: str) -> Iterator[Tuple[str, bool]]:
    """Oraciones limpias, cada una con si es una nota al pie."""
    texto = " ".join(texto.split())
    texto = _MENOS_DE.sub(" ", texto)
    texto = _PORCENTAJE_ENTRE_PARENTESIS.sub(" ", texto)
    texto = _PORCENTAJE.sub(" ", texto).replace("%", " ")
    for oracion in _dividir(texto, _es_fin_de_oracion):
        es_nota = _es_nota_al_pie(oracion)
        oracion = _PREFIJO.sub("", _MARCAS.sub("", oracion))
        oracion = _limpiar_puntuacion(oracion)
        if oracion:
            yield oracion, es_nota


def _analizar_lista(
    texto: str,
) -> Tuple[List[Ingrediente], List[str]]:
    ingredientes: List[Ingrediente] = []
    declaraciones: List[str] = []
    partes = [_limpiar_fragmento(p) for p in _dividir(texto, _es_coma)]
    for indice, parte in enumerate(partes):
        if not parte:
            continue
        if _es_declaracion(parte):
            # Lo que sigue en la misma lista es parte de la declaración:
            # "puede contener maní, almendras y soya".
            declaraciones.append(", ".join(p for p in partes[indice:] if p))
            break
        items, internas = _analizar_item(parte)
        ingredientes.extend(items)
        declaraciones.extend(internas)
    return ingredientes, declaraciones


def _analizar_item(texto: str) -> Tuple[List[Ingrediente], List[str]]:
    nombre, grupos = _separar_grupos(texto)
    subingredientes: List[Ingrediente] = []
    declaraciones: List[str] = []
    for grupo in grupos:
        items, internas = _analizar_lista(grupo)
        subingredientes.extend(items)
        declaraciones.extend(internas)
    nombre = _limpiar_fragmento(nombre)
    if not nombre:
        return subingredientes, declaraciones
    ingrediente = Ingrediente(nombre, tuple(_sin_repetidos(subingredientes)))
    return [ingrediente], declaraciones


def _separar_grupos(texto: str) -> Tuple[str, List[str]]:
    """Separa el texto fuera de paréntesis de los grupos de primer nivel.

    Un paréntesis sin cerrar abarca hasta el final; uno de cierre sobrante
    se ignora.
    """
    fuera: List[str] = []
    grupos: List[str] = []
    actual: List[str] = []
    profundidad = 0
    for caracter in texto:
        if caracter in _APERTURAS:
            if profundidad == 0:
                fuera.append("".join(actual))
                actual = []
            else:
                actual.append(caracter)
            profundidad += 1
        elif caracter in _CIERRES:
            if profundidad == 0:
                continue
            profundidad -= 1
            if profundidad == 0:
                grupos.append("".join(actual))
                actual = []
            else:
                actual.append(caracter)
        else:
            actual.append(caracter)
    if profundidad:
        grupos.append("".join(actual))
    else:
        fuera.append("".join(actual))
    return " ".join(fuera), grupos


def _dividir(
    texto: str, es_separador: Callable[[str, int], bool]
) -> List[str]:
    """Divide en los separadores que están fuera de paréntesis."""
    partes: List[str] = []
    actual: List[str] = []
    profundidad = 0
    for indice, caracter in enumerate(texto):
        if caracter in _APERTURAS:
            profundidad += 1
        elif caracter in _CIERRES:
            profundidad = max(0, profundidad - 1)
        elif profundidad == 0 and es_separador(texto, indice):
            partes.append("".join(actual))
            actual = []
            continue
        actual.append(caracter)
    partes.append("".join(actual))
    return partes


def _es_coma(texto: str, indice: int) -> bool:
    if texto[indice] == ";":
        return True
    if texto[indice] != ",":
        return False
    # "omega 3,6,9" o "1,5" no se cortan.
    antes = texto[indice - 1] if indice > 0 else ""
    despues = texto[indice + 1] if indice + 1 < len(texto) else ""
    return not (antes.isdigit() and despues.isdigit())


def _es_fin_de_oracion(texto: str, indice: int) -> bool:
    if texto[indice] != ".":
        return False
    siguiente = texto[indice + 1] if indice + 1 < len(texto) else " "
    previo = texto[indice - 1] if indice > 0 else ""
    if not (siguiente.isspace()
            or (siguiente.isupper() and previo.islower())):
        return False
    palabra = _PALABRA_FINAL.search(texto[:indice])
    return not (palabra and palabra.group(1).lower() in _ABREVIATURAS)


def _es_nota_al_pie(oracion: str) -> bool:
    """"*Ingrediente orgánico": empieza con asterisco y no es una lista."""
    texto = oracion.strip()
    return (texto.startswith("*") and "*" not in texto.lstrip("*")
            and "," not in texto)


def _es_declaracion(texto: str) -> bool:
    plano = normalizar(texto, singularizar=False)
    return any(plano == inicio or plano.startswith(inicio + " ")
               for inicio in _INICIOS_DECLARACION)


def _limpiar_puntuacion(texto: str) -> str:
    texto = _VINETAS.sub(",", texto)
    texto = _PARENTESIS_VACIOS.sub(" ", texto)
    texto = " ".join(texto.split())
    texto = _ESPACIO_ANTES.sub(r"\1", texto)
    texto = _ESPACIO_DESPUES.sub(r"\1", texto)
    texto = _SEPARADORES_REPETIDOS.sub(r"\1", texto)
    texto = _PUNTOS_REPETIDOS.sub(".", texto)
    return texto.strip(_BORDES)


def _limpiar_fragmento(texto: str) -> str:
    texto = " ".join(texto.split()).strip(_BORDES).lower()
    return _CONJUNCION_INICIAL.sub("", texto).strip(_BORDES)


def _sin_repetidos(ingredientes: Iterable[Ingrediente]) -> List[Ingrediente]:
    por_texto = {}
    for ingrediente in ingredientes:
        por_texto.setdefault(ingrediente.texto, ingrediente)
    return list(por_texto.values())
