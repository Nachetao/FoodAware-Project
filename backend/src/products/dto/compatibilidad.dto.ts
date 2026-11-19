import { ApiProperty } from "@nestjs/swagger";
import { AllergenCode } from "../contrato/enums";

/** Mismos valores que el campo veredicto del contrato de FastAPI. */
export const VEREDICTOS = ["apto", "apto_con_advertencia", "no_apto"] as const;
export type TipoVeredicto = (typeof VEREDICTOS)[number];

/** Compatibilidad de un producto con las alergias del usuario autenticado. */
export class Compatibilidad {
  @ApiProperty({
    enum: VEREDICTOS,
    description:
      "no_apto si algún alérgeno coincide; apto_con_advertencia si solo coinciden trazas o si, con alergias en el perfil, los datos no alcanzan (sin ingredientes o completitud menor que 0,5); apto en otro caso. Ante la duda nunca es apto.",
    example: "apto_con_advertencia",
  })
  veredicto: TipoVeredicto;

  @ApiProperty({
    description:
      'true solo si veredicto es "apto": nunca con alérgenos o trazas en conflicto, ni con datos insuficientes.',
    example: false,
  })
  apto: boolean;

  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: "Alérgenos del producto que el usuario no puede consumir.",
    example: [AllergenCode.LACTEOS],
  })
  alergenos_en_conflicto: AllergenCode[];

  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: 'Trazas ("puede contener") que coinciden con sus alergias.',
    example: [AllergenCode.MANI],
  })
  trazas_en_conflicto: AllergenCode[];

  @ApiProperty({
    description:
      "false si el producto no tiene ingredientes o su completitud es menor que 0,5.",
    example: true,
  })
  datos_suficientes: boolean;
}
