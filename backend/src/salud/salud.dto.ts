import { ApiProperty } from "@nestjs/swagger";

// Mismo formato que RespuestaSalud de FastAPI (docs/contratos/).
export const ESTADOS_SALUD = ["ok", "degradado", "error"] as const;
export type EstadoSalud = (typeof ESTADOS_SALUD)[number];

export const ESTADOS_DEPENDENCIA = [
  "ok",
  "degradado",
  "error",
  "no_verificado",
] as const;
export type EstadoDependencia = (typeof ESTADOS_DEPENDENCIA)[number];

export class DependenciasSalud {
  @ApiProperty({ enum: ESTADOS_DEPENDENCIA, example: "ok" })
  postgresql: EstadoDependencia;

  @ApiProperty({
    enum: ESTADOS_DEPENDENCIA,
    example: "ok",
    description:
      "ok o degradado según el /health de FastAPI; error si no responde (la búsqueda usa el respaldo).",
  })
  fastapi: EstadoDependencia;
}

export class DetallePostgresql {
  @ApiProperty({ type: Number, nullable: true, example: 3.2 })
  latencia_ms: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error: string | null;
}

export class DetalleFastApi {
  @ApiProperty({
    enum: ESTADOS_SALUD,
    nullable: true,
    description: "Estado que informó FastAPI; nulo si no respondió.",
    example: "ok",
  })
  estado: EstadoSalud | null;

  @ApiProperty({ type: Number, nullable: true, example: 12.5 })
  latencia_ms: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  error: string | null;
}

export class DetalleSalud {
  @ApiProperty({ type: () => DetallePostgresql })
  postgresql: DetallePostgresql;

  @ApiProperty({ type: () => DetalleFastApi })
  fastapi: DetalleFastApi;
}

export class RespuestaSalud {
  @ApiProperty({
    enum: ESTADOS_SALUD,
    description:
      "ok: todo responde. degradado (HTTP 200): FastAPI no está ok, la búsqueda usa el respaldo. error (HTTP 503): PostgreSQL no responde.",
    example: "ok",
  })
  estado: EstadoSalud;

  @ApiProperty({ example: "backend" })
  servicio: string;

  @ApiProperty({ example: "1.0.0" })
  version: string;

  @ApiProperty({ format: "date-time", example: "2026-10-22T14:30:00Z" })
  verificado_en: string;

  @ApiProperty({ type: () => DependenciasSalud })
  dependencias: DependenciasSalud;

  @ApiProperty({ type: () => DetalleSalud })
  detalle: DetalleSalud;
}
