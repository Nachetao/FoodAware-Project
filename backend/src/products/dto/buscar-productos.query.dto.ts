import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsString, Length, Max, Min } from "class-validator";

/** Query de GET /api/products/search, con las reglas de GET /search del contrato. */
export class BuscarProductosQueryDto {
  @ApiProperty({
    minLength: 2,
    maxLength: 100,
    description: "Texto a buscar.",
    example: "leche",
  })
  @IsString({ message: "q debe ser un texto" })
  @Length(2, 100, { message: "q debe tener entre 2 y 100 caracteres" })
  q: string;

  @ApiPropertyOptional({
    type: "integer",
    minimum: 1,
    maximum: 50,
    default: 10,
  })
  @Type(() => Number)
  @IsInt({ message: "limit debe ser un número entero" })
  @Min(1, { message: "limit debe ser al menos 1" })
  @Max(50, { message: "limit no puede ser mayor a 50" })
  limit: number = 10;

  @ApiPropertyOptional({ type: "integer", minimum: 0, default: 0 })
  @Type(() => Number)
  @IsInt({ message: "offset debe ser un número entero" })
  @Min(0, { message: "offset no puede ser negativo" })
  offset: number = 0;
}
