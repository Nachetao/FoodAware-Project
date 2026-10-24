import { AllergenCode, DietLabel, Nutriscore } from './enums';

/** Trazabilidad del registro: de dónde y cuándo se obtuvo. */
export interface Procedencia {
  fuente: 'openfoodfacts';
  url_fuente: string;
  /** ISO 8601 en UTC. */
  recuperado_en: string;
  /** ISO 8601 en UTC. */
  modificado_en_fuente: string | null;
  run_id: string;
  hash_contenido: string;
}

/** Resultado de la validación del registro. */
export interface Calidad {
  es_valido: boolean;
  problemas: string[];
  /** Fracción de campos relevantes presentes (0 a 1). */
  completitud: number;
}

/** Producto alimenticio normalizado. */
export interface Producto {
  codigo_barras: string;
  nombre: string;
  marca: string | null;
  cantidad: string | null;
  ingredientes_texto: string | null;
  ingredientes: string[];
  alergenos: AllergenCode[];
  trazas: AllergenCode[];
  etiquetas_dieta: DietLabel[];
  nutriscore: Nutriscore | null;
  imagen_url: string | null;
  procedencia: Procedencia;
  calidad: Calidad;
}

/** Detalle de un producto más el origen de los datos (X-Fuente-Datos). */
export interface DetalleProducto {
  producto: Producto;
  desdeRespaldo: boolean;
}
