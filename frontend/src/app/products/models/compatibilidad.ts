import { AllergenCode } from './enums';

/** Compatibilidad de un producto con las alergias del usuario autenticado. */
export interface Compatibilidad {
  /** false si algún alérgeno coincide; las trazas no lo hacen no apto. */
  apto: boolean;
  alergenos_en_conflicto: AllergenCode[];
  /** Trazas ("puede contener") que coinciden con sus alergias. */
  trazas_en_conflicto: AllergenCode[];
}
