import { ApiProperty } from "@nestjs/swagger";
import { AllergenCode } from "../contrato/enums";

/** Compatibilidad de un producto con las alergias del usuario autenticado. */
export class Compatibilidad {
  @ApiProperty({
    description:
      "false si algún alérgeno del producto coincide con las alergias del usuario. Las trazas no lo hacen no apto.",
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
}
