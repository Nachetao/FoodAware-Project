import { AllergenCode } from './enums';

/** Mismos valores que el veredicto del motor de FastAPI. */
export type Veredicto = 'apto' | 'apto_con_advertencia' | 'no_apto';

/** Compatibilidad de un producto con las alergias del usuario autenticado. */
export interface Compatibilidad {
  /**
   * no_apto: algún alérgeno coincide. apto_con_advertencia: solo coinciden
   * trazas, o faltan datos para confirmar. apto: nada de lo anterior.
   */
  veredicto: Veredicto;
  /** true solo si veredicto es "apto". */
  apto: boolean;
  alergenos_en_conflicto: AllergenCode[];
  /** Trazas ("puede contener") que coinciden con sus alergias. */
  trazas_en_conflicto: AllergenCode[];
  /** false si el producto no tiene ingredientes o su completitud es baja. */
  datos_suficientes: boolean;
}
