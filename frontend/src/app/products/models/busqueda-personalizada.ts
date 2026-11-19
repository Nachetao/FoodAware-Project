import { VeredictoProducto } from './compatibilidad';
import { AllergenCode, DietLabel, EstadoFuente } from './enums';
import { Producto } from './producto';

// Respuesta de GET /api/products/search/personalizada (la del motor
// adaptativo; ver backend/src/products/dto/busqueda-personalizada.dto.ts).

/** filtrar oculta los no_apto; reordenar los deja al final. */
export type ModoBusqueda = 'filtrar' | 'reordenar';

export interface PerfilRestricciones {
  alergias: AllergenCode[];
  dietas: DietLabel[];
  modo_estricto: boolean;
}

/** Restricción reconocida en la consulta: "sin leche" → alergeno lacteos. */
export interface RestriccionConsulta {
  texto: string;
  tipo: 'alergeno' | 'dieta';
  codigo: AllergenCode | DietLabel;
}

export interface InterpretacionConsulta {
  /** Términos que se buscaron. */
  terminos: string[];
  restricciones?: RestriccionConsulta[];
  /** Restricciones que no son un alérgeno ni una dieta ("sin azúcar"). */
  no_reconocidas?: string[];
}

export interface ResultadoPersonalizado {
  producto: Producto;
  score: number;
  /** Posición en el ranking personalizado, desde 1. */
  posicion: number;
  /** Posición en la búsqueda normal; nulo si no aparece ahí. */
  posicion_base?: number | null;
  veredicto: VeredictoProducto;
}

export interface ConteoMotivo {
  tipo: 'alergeno' | 'traza' | 'posible' | 'dieta' | 'datos_insuficientes';
  codigo?: AllergenCode | DietLabel | null;
  cantidad: number;
}

export interface ResumenNoAptos {
  total: number;
  /** true en modo filtrar (no aparecen); false en reordenar (van al final). */
  ocultos: boolean;
  motivos?: ConteoMotivo[];
  /** Resumen listo para mostrar. */
  texto: string;
}

export interface ComparacionRanking {
  k: number;
  top_base: string[];
  top_personalizado: string[];
}

export interface RespuestaBusquedaPersonalizada {
  consulta: string;
  interpretacion: InterpretacionConsulta;
  perfil_aplicado: PerfilRestricciones;
  modo: ModoBusqueda;
  /** Resultados visibles antes de paginar (sin los ocultos). */
  total: number;
  /** Coincidencias de la búsqueda normal. */
  total_base: number;
  tiempo_ms: number;
  estado_fuente: EstadoFuente;
  resultados: ResultadoPersonalizado[];
  no_aptos: ResumenNoAptos;
  /** null en el respaldo (X-Fuente-Datos: respaldo). */
  comparacion: ComparacionRanking | null;
  aviso: string;
}

/** Respuesta de la búsqueda personalizada más el origen de los datos. */
export interface BusquedaPersonalizada {
  respuesta: RespuestaBusquedaPersonalizada;
  /** true si el motor no respondió y el backend usó los productos guardados. */
  desdeRespaldo: boolean;
}
