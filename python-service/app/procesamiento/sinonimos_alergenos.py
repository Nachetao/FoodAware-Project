"""Diccionario de sinónimos de los 14 alérgenos, en español de Chile.

Se escriben con tildes y en su forma natural; al cargarlos se normalizan
igual que el texto (minúsculas, sin tildes, singular), así "nueces" y "nuez"
quedan iguales. Incluye algunos términos en inglés porque OFF mezcla
idiomas.

Criterio: ante la duda se marca. Un término ambiguo (como "harina" o
"manteca") se incluye, y en EXCEPCIONES solo van los falsos positivos claros.
"""
from typing import Dict, Tuple

from app.schemas.enums import AllergenCode as A

SINONIMOS: Dict[A, Tuple[str, ...]] = {
    A.lacteos: (
        "leche", "lactosa", "caseína", "caseinato", "suero lácteo",
        "suero de leche", "lactosuero", "suero en polvo",
        "proteína de suero", "mantequilla", "crema", "crema de leche",
        "nata", "queso", "quesillo", "requesón", "ricota", "yogur",
        "yogurt", "yoghurt", "kéfir", "ghee", "manjar", "lactoalbúmina",
        "lactoglobulina", "lácteo", "láctea",
        # En Chile "manteca" suele ser grasa de cerdo, pero en productos
        # argentinos es mantequilla: se marca salvo que diga de qué es.
        "manteca",
        "milk", "lactose", "butter", "buttermilk", "cream", "cheese",
        "whey", "casein", "caseinate", "dairy",
    ),
    A.gluten: (
        "trigo", "harina de trigo", "cebada", "centeno", "avena",
        "espelta", "malta", "sémola", "semolina", "gluten", "kamut",
        "triticale", "seitán", "bulgur", "cuscús", "cous cous",
        "germen de trigo", "pan rallado",
        # En Chile, "harina" sin más es de trigo.
        "harina",
        "wheat", "barley", "rye", "oat", "oats", "spelt", "malt", "flour",
    ),
    A.huevo: (
        "huevo", "clara", "yema", "albúmina", "ovoalbúmina", "ovomucoide",
        "lisozima", "E1105", "mayonesa", "merengue",
        "egg", "eggs", "albumen",
    ),
    A.mani: (
        "maní", "maníes", "cacahuate", "cacahuete", "arachis",
        "peanut", "peanuts",
    ),
    A.frutos_secos: (
        "almendra", "avellana", "nuez", "nueces", "castaña de cajú",
        "cajú", "anacardo", "pistacho", "macadamia", "pecana",
        "nuez de Brasil", "castaña de Pará", "castaña de Brasil",
        "frutos secos", "frutos de cáscara", "praliné", "gianduja",
        "mazapán", "turrón",
        "almond", "almonds", "hazelnut", "hazelnuts", "walnut", "walnuts",
        "cashew", "cashews", "pistachio", "pistachios", "pecan", "pecans",
        "nut", "nuts",
    ),
    A.soya: (
        "soya", "soja", "lecitina de soya", "lecitina de soja",
        # La lecitina sin origen suele ser de soya.
        "lecitina",
        "edamame", "tofu", "miso", "tempeh", "shoyu",
        "soy", "soybean", "soybeans", "lecithin",
    ),
    A.pescado: (
        "pescado", "pez", "atún", "salmón", "merluza", "jurel", "sardina",
        "anchoa", "anchoveta", "bacalao", "reineta", "congrio", "corvina",
        "trucha", "caballa", "albacora", "lenguado", "tilapia", "pejerrey",
        "palometa", "cojinova", "surimi", "kanikama",
        "fish", "tuna", "anchovy", "anchovies", "cod",
    ),
    A.crustaceos: (
        "crustáceo", "camarón", "langostino", "langosta", "jaiba",
        "centolla", "centollón", "cangrejo", "gamba", "krill", "picoroco",
        "cigala",
        # "Mariscos" puede ser crustáceo o molusco: se marcan ambos.
        "marisco",
        "shrimp", "prawn", "crab", "lobster", "shellfish",
    ),
    A.moluscos: (
        "molusco", "calamar", "pulpo", "almeja", "chorito", "choro",
        "cholga", "mejillón", "ostra", "ostión", "macha", "loco",
        "caracol", "jibia", "sepia", "lapa", "navaja", "vieira", "abalón",
        "marisco",
        "squid", "octopus", "clam", "mussel", "oyster", "scallop",
        "shellfish",
    ),
    A.sesamo: (
        "sésamo", "ajonjolí", "tahini", "tahina", "tahín", "gomasio",
        "halva",
        "sesame",
    ),
    A.mostaza: (
        "mostaza",
        "mustard",
    ),
    A.apio: (
        "apio", "apionabo",
        "celery", "celeriac",
    ),
    A.sulfitos: (
        "sulfito", "metabisulfito", "bisulfito", "anhídrido sulfuroso",
        "dióxido de azufre",
        # "INS 220" o "E-220" se normalizan a "e220".
        "E220", "E221", "E222", "E223", "E224", "E225", "E226", "E227",
        "E228",
        "sulfite", "sulphite", "metabisulfite", "metabisulphite",
        "sulfur dioxide", "sulphur dioxide",
    ),
    A.altramuces: (
        "altramuz", "altramuces", "lupino",
        "lupin", "lupine",
    ),
}

# Frases donde un sinónimo NO indica ese alérgeno. Solo excluyen a ese
# código: en "leche de almendras" se descarta lácteos, pero frutos_secos se
# sigue detectando por "almendras".
EXCEPCIONES: Dict[A, Tuple[str, ...]] = {
    A.lacteos: (
        "leche de coco", "leche de almendra", "leche de soya",
        "leche de soja", "leche de avena", "leche de arroz",
        "leche vegetal", "leche de maní", "leche de avellana",
        "leche de nuez", "leche de castaña de cajú", "leche de cajú",
        "leche de quinoa",
        "crema de coco", "crema de cacao", "crema de maní",
        "crema de cacahuate", "crema de almendra", "crema de avellana",
        "crema de arroz", "crema de soya", "crema vegetal",
        "mantequilla de maní", "mantequilla de cacahuate",
        "mantequilla de cacahuete", "mantequilla de almendra",
        "mantequilla de cacao", "mantequilla de karité",
        "manteca de cacao", "manteca de cerdo", "manteca vegetal",
        "manteca de karité", "manteca de palma", "manteca de coco",
        "manteca de maní", "manteca de cacahuate",
        "coconut milk", "almond milk", "soy milk", "oat milk", "rice milk",
        "coconut cream", "peanut butter", "cocoa butter", "shea butter",
    ),
    A.gluten: (
        "harina de maíz", "harina de arroz", "harina de garbanzo",
        "harina de papa", "harina de soya", "harina de soja",
        "harina de almendra", "harina de coco", "harina de quinoa",
        "harina de quínoa", "harina de quinua", "harina de yuca",
        "harina de mandioca", "harina de tapioca", "harina de arveja",
        "harina de lenteja", "harina de chía", "harina de linaza",
        "harina de pescado", "harina de maní", "harina de amaranto",
        "harina de sorgo", "harina de trigo sarraceno",
        "harina de alforfón", "harina de castaña", "harina de plátano",
        "harina de algarroba", "harina de lupino", "harina de cacao",
        "trigo sarraceno", "sémola de maíz", "sémola de arroz",
        "rice flour", "corn flour", "almond flour", "coconut flour",
        "soy flour", "potato flour", "tapioca flour", "chickpea flour",
        "cassava flour",
    ),
    A.soya: (
        "lecitina de girasol", "lecitina de raps", "lecitina de canola",
        "lecitina de colza", "lecitina de huevo", "sunflower lecithin",
    ),
    A.frutos_secos: (
        # La nuez moscada es una especia, no un fruto seco.
        "nuez moscada",
    ),
}

# Términos que, como nombre de un sabor, no indican el alérgeno: en "sabor
# leche y crema (saborizantes naturales)" o "milk flavour" se describe el
# sabor, no se agrega leche. Solo se descartan justo después de "sabor" /
# "sabor a" o justo antes de "flavor"; "leche sabor frutilla" se sigue
# marcando. "Queso" y "yogurt" quedan fuera a propósito: sus sabores suelen
# hacerse con queso o yogurt en polvo.
SABORES: Dict[A, Tuple[str, ...]] = {
    A.lacteos: (
        "leche", "crema", "mantequilla", "manjar",
        "milk", "cream", "butter",
    ),
}

# Indicios que no bastan para marcar el alérgeno, pero se registran como
# "alergeno_posible:<código>". La lecitina E322 suele ser de soya, pero
# también de girasol: solo cuenta si el ingrediente no dice su origen (las
# EXCEPCIONES del mismo código, como "lecitina de girasol").
POSIBLES: Dict[A, Tuple[str, ...]] = {
    A.soya: ("E322",),
}

# Frases que pasan lo que sigue a trazas: "puede contener maní".
FRASES_TRAZAS: Tuple[str, ...] = (
    "puede contener", "pueden contener", "podría contener", "puede tener",
    "puede presentar", "trazas", "elaborado en", "elaborada en",
    "fabricado en", "fabricada en", "producido en", "producida en",
    "envasado en", "envasada en", "procesado en", "línea que",
    "planta que", "instalaciones que", "equipos que", "comparte línea",
    "may contain", "may also contain", "traces", "manufactured in",
    "manufactured on", "produced in", "produced on", "made in a",
    "made on", "packed in", "processed in", "facility", "same line",
)
