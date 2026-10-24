import { AllergenCode } from "../products/contrato/enums";

/**
 * Variantes conocidas (ya normalizadas: minúsculas, sin tildes y con espacios
 * en vez de guiones bajos) de cada código de alérgeno del contrato.
 * La migración AlergiasUsuarioConCodigos usa la misma tabla en SQL.
 */
export const SINONIMOS_ALERGENOS: Record<string, AllergenCode> = {
  lacteos: AllergenCode.LACTEOS,
  lacteo: AllergenCode.LACTEOS,
  leche: AllergenCode.LACTEOS,
  lactosa: AllergenCode.LACTEOS,
  gluten: AllergenCode.GLUTEN,
  trigo: AllergenCode.GLUTEN,
  huevo: AllergenCode.HUEVO,
  huevos: AllergenCode.HUEVO,
  mani: AllergenCode.MANI,
  manies: AllergenCode.MANI,
  cacahuete: AllergenCode.MANI,
  cacahuate: AllergenCode.MANI,
  "frutos secos": AllergenCode.FRUTOS_SECOS,
  "fruto seco": AllergenCode.FRUTOS_SECOS,
  nueces: AllergenCode.FRUTOS_SECOS,
  soya: AllergenCode.SOYA,
  soja: AllergenCode.SOYA,
  pescado: AllergenCode.PESCADO,
  pescados: AllergenCode.PESCADO,
  crustaceos: AllergenCode.CRUSTACEOS,
  crustaceo: AllergenCode.CRUSTACEOS,
  moluscos: AllergenCode.MOLUSCOS,
  molusco: AllergenCode.MOLUSCOS,
  sesamo: AllergenCode.SESAMO,
  ajonjoli: AllergenCode.SESAMO,
  mostaza: AllergenCode.MOSTAZA,
  apio: AllergenCode.APIO,
  sulfitos: AllergenCode.SULFITOS,
  sulfito: AllergenCode.SULFITOS,
  altramuces: AllergenCode.ALTRAMUCES,
  altramuz: AllergenCode.ALTRAMUCES,
  lupino: AllergenCode.ALTRAMUCES,
};

/** Minúsculas, sin tildes, "_" como espacio y sin espacios sobrantes. */
export function normalizarTextoAlergeno(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

/** Código del contrato para un texto ("Maní", "lácteos", "soja"…), o null si no se reconoce. */
export function aCodigoAlergeno(texto: string): AllergenCode | null {
  return SINONIMOS_ALERGENOS[normalizarTextoAlergeno(texto)] ?? null;
}

/** Códigos reconocidos, sin repetir; los textos que no se reconocen se descartan. */
export function aCodigosAlergenos(textos: readonly string[]): AllergenCode[] {
  return [
    ...new Set(
      textos.map(aCodigoAlergeno).filter((c): c is AllergenCode => c !== null),
    ),
  ];
}
