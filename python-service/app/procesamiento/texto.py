"""Normalización de texto en español para comparar y buscar."""
import re
import unicodedata
from typing import List

# "sin" y "no" quedan fuera a propósito: en "leche sin lactosa" cambian el
# sentido y sirven para distinguir productos al buscar.
STOPWORDS = frozenset({
    "a", "al", "como", "con", "de", "del", "e", "el", "en", "entre", "es",
    "esa", "ese", "eso", "esta", "este", "esto", "estas", "estos", "hasta",
    "la", "las", "le", "les", "lo", "los", "mas", "muy", "o", "otra",
    "otro", "para", "pero", "por", "que", "se", "si", "sobre", "son", "su",
    "sus", "tambien", "u", "un", "una", "unas", "uno", "unos", "y", "ya",
    # Inglés, porque OFF mezcla idiomas en los textos.
    "and", "for", "in", "of", "or", "the", "to", "with",
})

# Plurales aparentes que no se recortan.
_INVARIABLES = frozenset({
    "ademas", "antes", "despues", "menos", "mientras", "tres",
})
_NO_ALFANUMERICO = re.compile(r"[^a-z0-9]+")
# "E-220", "e 220" o "INS 220" quedan como "e220".
_ADITIVO = re.compile(r"\b(?:e|ins) ?(\d{3,4}[a-z]?)\b")


def sin_tildes(texto: str) -> str:
    """Quita tildes y diéresis (la ñ queda como n)."""
    descompuesto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in descompuesto if not unicodedata.combining(c))


def singular(palabra: str) -> str:
    """Singular básico de una palabra ya normalizada.

    Solo aplica reglas simples; lo importante es que el diccionario y el
    texto pasen por la misma función, así ambos quedan iguales.
    """
    if (len(palabra) <= 3 or not palabra.endswith("s")
            or palabra in _INVARIABLES):
        return palabra
    if palabra.endswith("ces"):
        return palabra[:-3] + "z"  # nueces -> nuez
    if (palabra.endswith("es") and palabra[-3] in "lrnd"
            and palabra[-4] in "aeiou"):
        return palabra[:-2]  # cereales -> cereal, camarones -> camaron
    if palabra[-2] in "aeo":
        return palabra[:-1]  # almendras -> almendra, aceites -> aceite
    return palabra


def normalizar(texto: str, *, singularizar: bool = True) -> str:
    """Forma para comparar: minúsculas, sin tildes, sin puntuación y, por
    defecto, en singular."""
    plano = _NO_ALFANUMERICO.sub(" ", sin_tildes(texto.lower()))
    plano = _ADITIVO.sub(r"e\1", plano)
    palabras = plano.split()
    if singularizar:
        palabras = [singular(p) for p in palabras]
    return " ".join(palabras)


def tokenizar(texto: str) -> List[str]:
    """Tokens para búsqueda: normalizados, en singular, sin stopwords ni
    letras sueltas (unidades como "g" o "l")."""
    palabras = normalizar(texto, singularizar=False).split()
    return [
        singular(p) for p in palabras
        if p not in STOPWORDS and (len(p) > 1 or p.isdigit())
    ]
