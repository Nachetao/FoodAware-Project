import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsEnum } from "class-validator";
import { AllergenCode } from "../../products/contrato/enums";

export class ActualizarAlergiasDto {
  @ApiProperty({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: "Reemplaza todas las alergias; [] las borra.",
    example: [AllergenCode.MANI, AllergenCode.LACTEOS],
  })
  @IsArray({ message: "alergias debe ser una lista" })
  @IsEnum(AllergenCode, {
    each: true,
    message: `Cada alergia debe ser uno de estos códigos: ${Object.values(AllergenCode).join(", ")}`,
  })
  alergias: AllergenCode[];
}
