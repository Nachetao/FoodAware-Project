// Tipos de /api/metricas/calidad, /api/metricas/evaluacion e
// /api/ingesta/ultima (los mismos del contrato FastAPI).

/** Calidad de los datos almacenados. Porcentajes de 0 a 100. */
export interface MetricasCalidad {
  porcentaje_validos: number;
  porcentaje_duplicados: number;
  cobertura_ingredientes: number;
  antiguedad_promedio_horas: number;
  total_productos: number;
}

/** Evaluación de la búsqueda. Precision y recall de 0 a 1. */
export interface MetricasEvaluacion {
  k: number;
  precision_at_k: number;
  recall_at_k: number;
  consultas_evaluadas: number;
  tiempo_promedio_ms: number;
}

export type EstadoIngesta =
  | 'en_curso'
  | 'completado'
  | 'completado_con_errores'
  | 'fallido';

export interface ResumenIngesta {
  run_id: string;
  /** ISO 8601 en UTC. */
  inicio: string;
  fin: string | null;
  duracion_ms: number | null;
  recuperados: number;
  validos: number;
  invalidos: number;
  duplicados: number;
  errores: number;
  estado: EstadoIngesta;
}
