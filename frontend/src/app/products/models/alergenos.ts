import { AllergenCode } from './enums';

/** Nombre para mostrar de cada código de alérgeno del contrato. */
export const ETIQUETAS_ALERGENOS: Record<AllergenCode, string> = {
  lacteos: 'Lácteos',
  gluten: 'Gluten',
  huevo: 'Huevo',
  mani: 'Maní',
  frutos_secos: 'Frutos secos',
  soya: 'Soya',
  pescado: 'Pescado',
  crustaceos: 'Crustáceos',
  moluscos: 'Moluscos',
  sesamo: 'Sésamo',
  mostaza: 'Mostaza',
  apio: 'Apio',
  sulfitos: 'Sulfitos',
  altramuces: 'Altramuces',
};

/** Etiqueta de un alérgeno; si el backend envía un código nuevo, muestra el código. */
export function etiquetaAlergeno(codigo: string): string {
  return (ETIQUETAS_ALERGENOS as Record<string, string | undefined>)[codigo] ?? codigo;
}
