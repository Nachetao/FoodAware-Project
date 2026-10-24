import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayNotEmpty,
  IsOptional,
} from "class-validator";

export class AnalizarProductoDto {
  @IsString()
  @IsNotEmpty({ message: "El nombre del producto es obligatorio" })
  nombre: string;

  @IsArray()
  @ArrayNotEmpty({ message: "Debe incluir al menos un ingrediente" })
  @IsString({ each: true, message: "Cada ingrediente debe ser texto" })
  ingredientes: string[];

  // Se ignora: el usuario sale del token. Se acepta para no romper clientes
  // que todavía lo envían (forbidNonWhitelisted lo rechazaría).
  @IsOptional()
  userId?: unknown;
}
