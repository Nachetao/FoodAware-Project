import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AllergenCode, DietLabel, ESTADOS_FUENTE, EstadoFuente } from "./enums";
import { Producto } from "./producto";

// Capacidad adaptativa del contrato de FastAPI (docs/contratos/README.md,
// sección "Capacidad adaptativa"): POST /products/{codigo}/compatibility y
// POST /search/personalized.

export const VEREDICTOS = ["apto", "apto_con_advertencia", "no_apto"] as const;
export type TipoVeredicto = (typeof VEREDICTOS)[number];

export const CONFIANZAS = ["alta", "media", "baja"] as const;
export type Confianza = (typeof CONFIANZAS)[number];

export const MOTIVOS_CONFIANZA = [
  "completitud_media",
  "completitud_baja",
  "sin_ingredientes",
  "alergenos_no_reconocidos",
  "conflicto_solo_en_texto",
  "indicio_sin_confirmar",
] as const;
export type MotivoConfianza = (typeof MOTIVOS_CONFIANZA)[number];

export const TIPOS_CONFLICTO = [
  "alergeno",
  "traza",
  "posible",
  "dieta",
] as const;
export type TipoConflicto = (typeof TIPOS_CONFLICTO)[number];

export const ORIGENES_CONFLICTO = ["fuente", "texto", "indicio"] as const;
export type OrigenConflicto = (typeof ORIGENES_CONFLICTO)[number];

export const TIPOS_MOTIVO_NO_APTO = [
  ...TIPOS_CONFLICTO,
  "datos_insuficientes",
] as const;
export type TipoMotivoNoApto = (typeof TIPOS_MOTIVO_NO_APTO)[number];

export const MODOS_BUSQUEDA = ["filtrar", "reordenar"] as const;
export type ModoBusqueda = (typeof MODOS_BUSQUEDA)[number];

/** Alérgeno o dieta: los códigos que usan conflictos y motivos. */
const CODIGOS = [...Object.values(AllergenCode), ...Object.values(DietLabel)];
type Codigo = AllergenCode | DietLabel;

/** Restricciones de una persona, sin datos que la identifiquen. */
export class PerfilRestricciones {
  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    example: [AllergenCode.LACTEOS, AllergenCode.MANI],
  })
  alergias: AllergenCode[];

  @ApiProperty({
    enum: DietLabel,
    enumName: "DietLabel",
    isArray: true,
    example: [],
  })
  dietas: DietLabel[];

  @ApiProperty({
    description:
      "true: las trazas, los indicios y los datos insuficientes hacen el producto no_apto.",
    example: false,
  })
  modo_estricto: boolean;
}

export class Conflicto {
  @ApiProperty({
    enum: CODIGOS,
    description:
      "Alérgeno en conflicto, o la dieta contradicha si tipo es dieta.",
    example: AllergenCode.LACTEOS,
  })
  codigo: Codigo;

  @ApiProperty({ enum: TIPOS_CONFLICTO, example: "alergeno" })
  tipo: TipoConflicto;

  @ApiProperty({
    enum: ORIGENES_CONFLICTO,
    description:
      "fuente: lo declara Open Food Facts; texto: solo se detectó en los ingredientes; indicio: alérgeno posible.",
    example: "fuente",
  })
  origen: OrigenConflicto;
}

export class MotivoNoApto {
  @ApiProperty({ enum: TIPOS_MOTIVO_NO_APTO, example: "alergeno" })
  tipo: TipoMotivoNoApto;

  @ApiPropertyOptional({
    enum: CODIGOS,
    nullable: true,
    description: "Nulo solo si tipo es datos_insuficientes.",
    example: AllergenCode.LACTEOS,
  })
  codigo?: Codigo | null;
}

/** Veredicto de compatibilidad de un producto con un perfil. */
export class Veredicto {
  @ApiProperty({ pattern: "^\\d{8,14}$", example: "7802920000015" })
  codigo_barras: string;

  @ApiProperty({
    enum: VEREDICTOS,
    description:
      "Ante la duda nunca es apto: el error más grave es un falso apto.",
    example: "no_apto",
  })
  veredicto: TipoVeredicto;

  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: "Alergias del perfil que el producto tiene como ingrediente.",
    example: [AllergenCode.LACTEOS],
  })
  alergenos_en_conflicto: AllergenCode[];

  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description:
      "Lo que el perfil evita (por alergia o dieta) y el producto puede contener.",
    example: [],
  })
  trazas_en_conflicto: AllergenCode[];

  @ApiProperty({
    enum: DietLabel,
    enumName: "DietLabel",
    isArray: true,
    description: "Dietas del perfil que el producto no declara cumplir.",
    example: [],
  })
  dietas_no_confirmadas: DietLabel[];

  @ApiProperty({ type: () => [Conflicto] })
  conflictos: Conflicto[];

  @ApiProperty({
    type: () => [MotivoNoApto],
    description: "Qué lo hizo no_apto; vacío en los demás veredictos.",
  })
  motivos_no_apto: MotivoNoApto[];

  @ApiProperty({
    description:
      "false si no tiene ingredientes, trae alérgenos no reconocidos o su completitud es menor que 0,5.",
    example: true,
  })
  datos_suficientes: boolean;

  @ApiProperty({
    description: "Explicación en español, para mostrar tal cual.",
    example: "Contiene lácteos, que está en tu perfil.",
  })
  explicacion: string;

  @ApiProperty({ enum: CONFIANZAS, example: "alta" })
  confianza: Confianza;

  @ApiProperty({
    enum: MOTIVOS_CONFIANZA,
    isArray: true,
    description: "Por qué la confianza no es alta; vacío si lo es.",
    example: [],
  })
  motivos_confianza: MotivoConfianza[];

  @ApiProperty({
    description:
      "Aviso permanente: la clasificación es orientativa. Se muestra junto al veredicto.",
  })
  aviso: string;
}

/** Cuerpo de POST /search/personalized. */
export interface SolicitudBusquedaPersonalizada {
  consulta: string;
  perfil: PerfilRestricciones;
  modo: ModoBusqueda;
  limit: number;
  offset: number;
}

export class RestriccionConsulta {
  @ApiProperty({ description: "Frase de la consulta.", example: "sin leche" })
  texto: string;

  @ApiProperty({ enum: ["alergeno", "dieta"], example: "alergeno" })
  tipo: "alergeno" | "dieta";

  @ApiProperty({ enum: CODIGOS, example: AllergenCode.LACTEOS })
  codigo: Codigo;
}

export class InterpretacionConsulta {
  @ApiProperty({
    type: [String],
    description: "Términos que se buscaron con BM25.",
    example: ["chocolate"],
  })
  terminos: string[];

  @ApiPropertyOptional({ type: () => [RestriccionConsulta] })
  restricciones?: RestriccionConsulta[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Restricciones no reconocidas ("sin azúcar").',
    example: [],
  })
  no_reconocidas?: string[];
}

export class ResultadoPersonalizado {
  @ApiProperty({ type: () => Producto })
  producto: Producto;

  @ApiProperty({ minimum: 0, description: "Score BM25.", example: 7.8421 })
  score: number;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    description: "Posición en el ranking personalizado, desde 1.",
    example: 1,
  })
  posicion: number;

  @ApiPropertyOptional({
    type: "integer",
    minimum: 1,
    nullable: true,
    description:
      "Posición en GET /search con la consulta original; nulo si no aparece.",
    example: 9,
  })
  posicion_base?: number | null;

  @ApiProperty({ type: () => Veredicto })
  veredicto: Veredicto;
}

export class ConteoMotivo {
  @ApiProperty({ enum: TIPOS_MOTIVO_NO_APTO, example: "alergeno" })
  tipo: TipoMotivoNoApto;

  @ApiPropertyOptional({ enum: CODIGOS, nullable: true, example: "lacteos" })
  codigo?: Codigo | null;

  @ApiProperty({ type: "integer", minimum: 1, example: 3 })
  cantidad: number;
}

export class ResumenNoAptos {
  @ApiProperty({ type: "integer", minimum: 0, example: 3 })
  total: number;

  @ApiProperty({
    description: "true en modo filtrar; false en reordenar (van al final).",
    example: true,
  })
  ocultos: boolean;

  @ApiPropertyOptional({ type: () => [ConteoMotivo] })
  motivos?: ConteoMotivo[];

  @ApiProperty({
    description: "Resumen listo para mostrar.",
    example: "3 ocultos: 2 por contener lácteos y 1 por poder contener maní.",
  })
  texto: string;
}

export class SalidaTop {
  @ApiProperty({ pattern: "^\\d{8,14}$", example: "7800000000013" })
  codigo_barras: string;

  @ApiProperty({ type: "integer", minimum: 1, example: 1 })
  posicion_base: number;

  @ApiPropertyOptional({
    type: "integer",
    minimum: 1,
    nullable: true,
    description: "Nulo si quedó oculto o no coincide sin las restricciones.",
    example: null,
  })
  posicion?: number | null;

  @ApiProperty({ enum: VEREDICTOS, example: "no_apto" })
  veredicto: TipoVeredicto;
}

export class ComparacionRanking {
  @ApiProperty({ type: "integer", minimum: 1, example: 5 })
  k: number;

  @ApiProperty({
    type: [String],
    description: "Los k primeros del ranking base.",
  })
  top_base: string[];

  @ApiProperty({
    type: [String],
    description: "Los k primeros del ranking personalizado.",
  })
  top_personalizado: string[];

  @ApiPropertyOptional({ type: () => [SalidaTop] })
  salieron_del_top?: SalidaTop[];

  @ApiPropertyOptional({ type: [String] })
  entraron_al_top?: string[];
}

/** Respuesta de POST /search/personalized. */
export class RespuestaBusquedaPersonalizada {
  @ApiProperty({ example: "chocolate sin leche" })
  consulta: string;

  @ApiProperty({ type: () => InterpretacionConsulta })
  interpretacion: InterpretacionConsulta;

  @ApiProperty({
    type: () => PerfilRestricciones,
    description: "El perfil recibido más las restricciones de la consulta.",
  })
  perfil_aplicado: PerfilRestricciones;

  @ApiProperty({ enum: MODOS_BUSQUEDA, example: "filtrar" })
  modo: ModoBusqueda;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    description:
      "Resultados del ranking personalizado antes de paginar (sin los ocultos).",
    example: 6,
  })
  total: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    description: "Coincidencias del ranking base.",
    example: 31,
  })
  total_base: number;

  @ApiProperty({ minimum: 0, example: 3.2 })
  tiempo_ms: number;

  @ApiProperty({ enum: ESTADOS_FUENTE, example: "cache" })
  estado_fuente: EstadoFuente;

  @ApiProperty({ type: () => [ResultadoPersonalizado] })
  resultados: ResultadoPersonalizado[];

  @ApiProperty({ type: () => ResumenNoAptos })
  no_aptos: ResumenNoAptos;

  @ApiProperty({ type: () => ComparacionRanking })
  comparacion: ComparacionRanking;

  @ApiProperty({
    description: "Aviso permanente: la clasificación es orientativa.",
  })
  aviso: string;
}
