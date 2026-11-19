import { AllergenCode, DietLabel } from './enums';

// Veredicto del motor adaptativo, tal como lo responde el backend
// (backend/src/products/contrato/adaptativo.ts y dto/compatibilidad.dto.ts).

/** Mismos valores que el veredicto del motor de FastAPI. */
export type Veredicto = 'apto' | 'apto_con_advertencia' | 'no_apto';

export type Confianza = 'alta' | 'media' | 'baja';

/**
 * Por qué la confianza no es alta. evaluacion_de_respaldo es propio del
 * backend: el motor no respondió y el veredicto es una revisión básica.
 */
export type MotivoConfianza =
  | 'completitud_media'
  | 'completitud_baja'
  | 'sin_ingredientes'
  | 'alergenos_no_reconocidos'
  | 'conflicto_solo_en_texto'
  | 'indicio_sin_confirmar'
  | 'evaluacion_de_respaldo';

export interface Conflicto {
  /** Alérgeno en conflicto, o la dieta contradicha si tipo es dieta. */
  codigo: AllergenCode | DietLabel;
  tipo: 'alergeno' | 'traza' | 'posible' | 'dieta';
  /** fuente: Open Food Facts; texto: detectado en los ingredientes; indicio: posible. */
  origen: 'fuente' | 'texto' | 'indicio';
}

export interface MotivoNoApto {
  tipo: 'alergeno' | 'traza' | 'posible' | 'dieta' | 'datos_insuficientes';
  /** Nulo solo si tipo es datos_insuficientes. */
  codigo?: AllergenCode | DietLabel | null;
}

/** Veredicto de un producto para el perfil del usuario. */
export interface VeredictoProducto {
  codigo_barras: string;
  veredicto: Veredicto;
  alergenos_en_conflicto: AllergenCode[];
  /** Trazas ("puede contener") de lo que el perfil evita. */
  trazas_en_conflicto: AllergenCode[];
  dietas_no_confirmadas: DietLabel[];
  conflictos: Conflicto[];
  /** Qué lo hizo no_apto; vacío en los demás veredictos. */
  motivos_no_apto: MotivoNoApto[];
  /** false si no tiene ingredientes o su completitud es baja. */
  datos_suficientes: boolean;
  /** Explicación en español, para mostrar tal cual. */
  explicacion: string;
  confianza: Confianza;
  /** Vacío si la confianza es alta. */
  motivos_confianza: MotivoConfianza[];
  /** Aviso permanente: la clasificación es orientativa, no una garantía. */
  aviso: string;
}

/** Respuesta de /api/products/:codigo_barras/compatibilidad. */
export interface Compatibilidad extends VeredictoProducto {
  /** true solo si veredicto es "apto". */
  apto: boolean;
}

/** Compatibilidad más el origen de los datos. */
export interface DetalleCompatibilidad {
  compatibilidad: Compatibilidad;
  /**
   * true si el motor no respondió y el backend usó la revisión básica sobre
   * el producto guardado (header X-Fuente-Datos: respaldo).
   */
  desdeRespaldo: boolean;
}
