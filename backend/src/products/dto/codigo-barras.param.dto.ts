import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";

/** Parámetro de GET /api/products/:codigo_barras, con la regla del contrato. */
export class CodigoBarrasParamDto {
  @ApiProperty({
    pattern: "^\\d{8,14}$",
    description: "Código de barras de 8 a 14 dígitos.",
    example: "7802800716999",
  })
  @Matches(/^\d{8,14}$/, {
    message: "codigo_barras debe tener de 8 a 14 dígitos",
  })
  codigo_barras: string;
}
