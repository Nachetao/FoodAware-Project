from enum import Enum


class AllergenCode(str, Enum):
    """Alérgenos de declaración obligatoria, con códigos sin tildes."""

    lacteos = "lacteos"
    gluten = "gluten"
    huevo = "huevo"
    mani = "mani"
    frutos_secos = "frutos_secos"
    soya = "soya"
    pescado = "pescado"
    crustaceos = "crustaceos"
    moluscos = "moluscos"
    sesamo = "sesamo"
    mostaza = "mostaza"
    apio = "apio"
    sulfitos = "sulfitos"
    altramuces = "altramuces"


class DietLabel(str, Enum):
    """Etiquetas de dieta que el servicio puede inferir de un producto."""

    vegano = "vegano"
    vegetariano = "vegetariano"
    sin_gluten = "sin_gluten"
    sin_lactosa = "sin_lactosa"


class CodigoError(str, Enum):
    """Códigos de error uniformes del contrato."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"
    SOURCE_TIMEOUT = "SOURCE_TIMEOUT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
