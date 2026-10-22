// Tipos del contrato (docs/contratos/fastapi-openapi.json). Son uniones de
// strings porque los datos llegan en JSON y se usan tal cual.

/** Alérgenos de declaración obligatoria, con códigos sin tildes. */
export type AllergenCode =
  | 'lacteos'
  | 'gluten'
  | 'huevo'
  | 'mani'
  | 'frutos_secos'
  | 'soya'
  | 'pescado'
  | 'crustaceos'
  | 'moluscos'
  | 'sesamo'
  | 'mostaza'
  | 'apio'
  | 'sulfitos'
  | 'altramuces';

/** Etiquetas de dieta que el servicio puede inferir de un producto. */
export type DietLabel = 'vegano' | 'vegetariano' | 'sin_gluten' | 'sin_lactosa';

/** Códigos de error uniformes del contrato. */
export const CODIGOS_ERROR = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'SOURCE_TIMEOUT',
  'INTERNAL_ERROR',
] as const;
export type CodigoError = (typeof CODIGOS_ERROR)[number];

export type Nutriscore = 'a' | 'b' | 'c' | 'd' | 'e';

export type EstadoFuente = 'online' | 'cache';
