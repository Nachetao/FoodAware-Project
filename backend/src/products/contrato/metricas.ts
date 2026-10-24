import { ApiProperty } from "@nestjs/swagger";

// Tipos de GET /metrics/quality, /metrics/evaluation e /ingest/runs/latest
// del contrato FastAPI (docs/contratos/).

/** Métricas de calidad de los datos almacenados. Porcentajes de 0 a 100. */
export class MetricasCalidad {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: "Válidos sobre recuperados en las ingestas terminadas.",
    example: 92,
  })
  porcentaje_validos: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: "Duplicados sobre válidos en las ingestas terminadas.",
    example: 5,
  })
  porcentaje_duplicados: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description:
      "Porcentaje de productos recuperados con ingredientes utilizables tras la limpieza.",
    example: 87.5,
  })
  cobertura_ingredientes: number;

  @ApiProperty({
    minimum: 0,
    description:
      "Horas promedio desde la última verificación de cada producto contra la fuente.",
    example: 18.2,
  })
  antiguedad_promedio_horas: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    description: "Productos válidos en la caché.",
    example: 1240,
  })
  total_productos: number;
}

/** Evaluación de la búsqueda (promedios macro). */
export class MetricasEvaluacion {
  @ApiProperty({ type: "integer", minimum: 1, maximum: 50, example: 5 })
  k: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.8 })
  precision_at_k: number;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.65 })
  recall_at_k: number;

  @ApiProperty({ type: "integer", minimum: 0, example: 20 })
  consultas_evaluadas: number;

  @ApiProperty({ minimum: 0, example: 14.3 })
  tiempo_promedio_ms: number;
}

export const ESTADOS_INGESTA = [
  "en_curso",
  "completado",
  "completado_con_errores",
  "fallido",
] as const;
export type EstadoIngesta = (typeof ESTADOS_INGESTA)[number];

/** Resumen de una ejecución de ingesta desde Open Food Facts. */
export class ResumenIngesta {
  @ApiProperty({ format: "uuid" })
  run_id: string;

  @ApiProperty({ format: "date-time", example: "2026-10-20T14:00:00Z" })
  inicio: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Nulo mientras la ejecución está en curso.",
  })
  fin: string | null;

  @ApiProperty({ type: "integer", nullable: true, minimum: 0, example: 150000 })
  duracion_ms: number | null;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    description: "Productos descargados.",
  })
  recuperados: number;

  @ApiProperty({ type: "integer", minimum: 0 })
  validos: number;

  @ApiProperty({ type: "integer", minimum: 0 })
  invalidos: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    description: "Válidos descartados por existir ya con el mismo contenido.",
  })
  duplicados: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    description: "Peticiones a la fuente que fallaron.",
  })
  errores: number;

  @ApiProperty({ enum: ESTADOS_INGESTA, example: "completado" })
  estado: EstadoIngesta;
}
