import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  IsOptional,
  IsUUID,
} from "class-validator";

export class AnalizarProductoDto {
  @IsString()
  @IsNotEmpty({ message: "El nombre del producto es obligatorio" })
  nombre: string;

  @IsArray()
  @ArrayNotEmpty({ message: "Debe incluir al menos un ingrediente" })
  @IsString({ each: true, message: "Cada ingrediente debe ser texto" })
  ingredientes: string[];

  @IsOptional()
  @IsUUID("4", { message: "El userId debe ser un ID válido" })
  userId?: string;
}
