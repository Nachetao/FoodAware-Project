import { ApiProperty } from "@nestjs/swagger";
import { AllergenCode, DietLabel, NUTRISCORES, Nutriscore } from "./enums";

/** Trazabilidad del registro: de dónde y cuándo se obtuvo. */
export class Procedencia {
  @ApiProperty({
    enum: ["openfoodfacts"],
    default: "openfoodfacts",
    description: "Fuente web de la que proviene el producto.",
  })
  fuente: "openfoodfacts";

  @ApiProperty({
    format: "uri",
    maxLength: 2083,
    description: "URL pública del producto en la fuente.",
    example: "https://world.openfoodfacts.org/product/7802800716999",
  })
  url_fuente: string;

  @ApiProperty({
    format: "date-time",
    description: "Momento de la descarga; se normaliza a UTC.",
    example: "2026-10-20T14:30:00Z",
  })
  recuperado_en: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Última modificación informada por la fuente, en UTC.",
    example: "2026-09-02T08:15:00Z",
  })
  modificado_en_fuente: string | null;

  @ApiProperty({
    format: "uuid",
    description: "Ejecución de ingesta que obtuvo el registro.",
  })
  run_id: string;

  @ApiProperty({
    pattern: "^[a-f0-9]{64}$",
    description:
      "SHA-256 del contenido normalizado; sirve para detectar cambios y duplicados.",
  })
  hash_contenido: string;
}

/** Resultado de la validación del registro. */
export class Calidad {
  @ApiProperty({
    description: "Indica si el registro cumple las reglas mínimas.",
  })
  es_valido: boolean;

  @ApiProperty({
    type: [String],
    description: "Problemas detectados durante la validación.",
    example: ["sin_ingredientes", "sin_imagen"],
  })
  problemas: string[];

  @ApiProperty({
    minimum: 0,
    maximum: 1,
    description: "Fracción de campos relevantes presentes (0 a 1).",
    example: 0.85,
  })
  completitud: number;
}

/** Producto alimenticio normalizado. */
export class Producto {
  @ApiProperty({
    pattern: "^\\d{8,14}$",
    description: "Código de barras de 8 a 14 dígitos.",
    example: "7802800716999",
  })
  codigo_barras: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 300,
    description: "Nombre comercial del producto.",
    example: "Leche semidescremada",
  })
  nombre: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 200,
    description: "Marca.",
    example: "Colun",
  })
  marca: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 50,
    description: "Contenido neto tal como lo informa la fuente.",
    example: "1 L",
  })
  cantidad: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 5000,
    description: "Lista de ingredientes original, sin procesar.",
  })
  ingredientes_texto: string | null;

  @ApiProperty({
    type: [String],
    description:
      "Ingredientes normalizados (minúsculas, sin espacios sobrantes).",
    example: ["leche semidescremada", "vitamina a", "vitamina d3"],
  })
  ingredientes: string[];

  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: "Alérgenos presentes como ingrediente.",
  })
  alergenos: AllergenCode[];

  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: "Alérgenos que pueden estar presentes como trazas.",
  })
  trazas: AllergenCode[];

  @ApiProperty({
    enum: DietLabel,
    enumName: "DietLabel",
    isArray: true,
    description: "Dietas con las que el producto es compatible.",
  })
  etiquetas_dieta: DietLabel[];

  @ApiProperty({
    enum: NUTRISCORES,
    nullable: true,
    description: "Nutri-Score en minúscula.",
    example: "b",
  })
  nutriscore: Nutriscore | null;

  @ApiProperty({
    type: String,
    format: "uri",
    nullable: true,
    maxLength: 2083,
    description: "Imagen principal del producto.",
  })
  imagen_url: string | null;

  @ApiProperty({ type: () => Procedencia })
  procedencia: Procedencia;

  @ApiProperty({ type: () => Calidad })
  calidad: Calidad;
}
