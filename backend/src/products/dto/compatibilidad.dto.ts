import { ApiProperty, OmitType } from "@nestjs/swagger";
import { MOTIVOS_CONFIANZA, Veredicto } from "../contrato/adaptativo";

/**
 * Motivo propio de NestJS (no está en el contrato de FastAPI): el veredicto
 * salió de la regla local porque el motor no estaba disponible.
 */
export const EVALUACION_DE_RESPALDO = "evaluacion_de_respaldo";

export const MOTIVOS_CONFIANZA_BACKEND = [
  ...MOTIVOS_CONFIANZA,
  EVALUACION_DE_RESPALDO,
] as const;
export type MotivoConfianzaBackend = (typeof MOTIVOS_CONFIANZA_BACKEND)[number];

/**
 * Respuesta de GET /api/products/:codigo_barras/compatibilidad: el Veredicto
 * del motor adaptativo más el campo apto que ya usaba el frontend.
 */
export class Compatibilidad extends OmitType(Veredicto, [
  "motivos_confianza",
] as const) {
  @ApiProperty({
    description:
      'true solo si veredicto es "apto": nunca con alérgenos o trazas en conflicto, ni con datos insuficientes.',
    example: false,
  })
  apto: boolean;

  @ApiProperty({
    enum: MOTIVOS_CONFIANZA_BACKEND,
    isArray: true,
    description:
      'Por qué la confianza no es alta; vacío si lo es. Además de los motivos del motor, "evaluacion_de_respaldo" indica que el motor no estaba disponible y el veredicto salió de una revisión básica de las alergias (X-Fuente-Datos: respaldo).',
    example: [],
  })
  motivos_confianza: MotivoConfianzaBackend[];
}
