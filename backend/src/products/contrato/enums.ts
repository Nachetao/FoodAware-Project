// Enums del contrato FastAPI (docs/contratos/fastapi-openapi.json).

/** Alérgenos de declaración obligatoria, con códigos sin tildes. */
export enum AllergenCode {
  LACTEOS = "lacteos",
  GLUTEN = "gluten",
  HUEVO = "huevo",
  MANI = "mani",
  FRUTOS_SECOS = "frutos_secos",
  SOYA = "soya",
  PESCADO = "pescado",
  CRUSTACEOS = "crustaceos",
  MOLUSCOS = "moluscos",
  SESAMO = "sesamo",
  MOSTAZA = "mostaza",
  APIO = "apio",
  SULFITOS = "sulfitos",
  ALTRAMUCES = "altramuces",
}

/** Etiquetas de dieta que el servicio puede inferir de un producto. */
export enum DietLabel {
  VEGANO = "vegano",
  VEGETARIANO = "vegetariano",
  SIN_GLUTEN = "sin_gluten",
  SIN_LACTOSA = "sin_lactosa",
}

/** Códigos de error uniformes del contrato. */
export enum CodigoError {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE",
  SOURCE_TIMEOUT = "SOURCE_TIMEOUT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export const NUTRISCORES = ["a", "b", "c", "d", "e"] as const;
export type Nutriscore = (typeof NUTRISCORES)[number];

export const ESTADOS_FUENTE = ["online", "cache"] as const;
export type EstadoFuente = (typeof ESTADOS_FUENTE)[number];
