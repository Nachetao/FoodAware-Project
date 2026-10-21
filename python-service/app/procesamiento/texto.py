"""Normalización de texto en español para comparar y buscar."""
import re
import unicodedata
from typing import Dict, List

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


# Equivalencias de vocabulario para la búsqueda: variante -> forma canónica.
# Son solo palabras que significan lo mismo, encontradas en el corpus real
# (variantes regionales del español y el inglés que mezcla Open Food Facts,
# cuyas etiquetas de categoría están en inglés). No dependen de ninguna
# consulta. Se escriben en su forma natural y se normalizan al cargar.
_EQUIVALENCIAS = {
    # Variantes del español (la canónica es la chilena).
    "soja": "soya",
    "cacahuete": "maní",
    "cacahuate": "maní",
    "yogur": "yogurt",
    "yoghurt": "yogurt",
    "yoghourt": "yogurt",
    "galletita": "galleta",
    "fresa": "frutilla",
    "patata": "papa",
    "maravilla": "girasol",  # aceite de maravilla = de girasol
    "remolacha": "betarraga",
    "calabaza": "zapallo",
    "choclo": "maíz",
    "aguacate": "palta",
    "melocotón": "durazno",
    "albaricoque": "damasco",
    "guisante": "arveja",
    # "snacks" no pasa a singular con las reglas del español.
    "snacks": "snack",
    # Inglés -> español. Los plurales en inglés van aparte porque singular()
    # no los recorta ("biscuits", "oats").
    "soy": "soya",
    "soybean": "soya",
    "soybeans": "soya",
    "peanut": "maní",
    "peanuts": "maní",
    "almond": "almendra",
    "almonds": "almendra",
    "hazelnut": "avellana",
    "hazelnuts": "avellana",
    "walnut": "nuez",
    "walnuts": "nuez",
    "milk": "leche",
    "dairy": "lácteo",
    "dairies": "lácteo",
    "cheese": "queso",
    "butter": "mantequilla",
    "cream": "crema",
    "oat": "avena",
    "oats": "avena",
    "rice": "arroz",
    "wheat": "trigo",
    "wholegrain": "integral",
    "corn": "maíz",
    "potato": "papa",
    "potatoes": "papa",
    "bread": "pan",
    "breads": "pan",
    "biscuit": "galleta",
    "biscuits": "galleta",
    "cookie": "galleta",
    "cookies": "galleta",
    "cocoa": "cacao",
    "bitter": "amargo",
    "sugar": "azúcar",
    "salt": "sal",
    "honey": "miel",
    "coconut": "coco",
    "vanilla": "vainilla",
    "orange": "naranja",
    "lemon": "limón",
    "strawberry": "frutilla",
    "strawberries": "frutilla",
    "sunflower": "girasol",
    "drink": "bebida",
    "beverage": "bebida",
    "beverages": "bebida",
}


def _forma_de_token(palabra: str) -> str:
    """La forma que tendría la palabra después de tokenizar."""
    return singular(normalizar(palabra, singularizar=False))


SINONIMOS: Dict[str, str] = {
    _forma_de_token(variante): _forma_de_token(canonica)
    for variante, canonica in _EQUIVALENCIAS.items()
}


def canonica(token: str) -> str:
    """Forma canónica de un token ya normalizado ("soja" -> "soya")."""
    return SINONIMOS.get(token, token)


def tokenizar(texto: str) -> List[str]:
    """Tokens para búsqueda: normalizados, en singular, sin stopwords ni
    letras sueltas (unidades como "g" o "l"), y en su forma canónica.

    Es la única tokenización del buscador: la usan tanto el índice como las
    consultas, así "Bebida de soja" y "bebida de soya" dan los mismos
    términos.
    """
    palabras = normalizar(texto, singularizar=False).split()
    return [
        canonica(singular(p)) for p in palabras
        if p not in STOPWORDS and (len(p) > 1 or p.isdigit())
    ]
