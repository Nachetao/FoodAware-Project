import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
} from "class-validator";

export class CreateFoodDto {
  @IsString()
  @IsNotEmpty({ message: "El nombre del alimento es obligatorio" })
  nombre: string;

  @IsArray()
  @IsString({ each: true, message: "Cada ingrediente debe ser un texto" })
  @IsNotEmpty({ message: "La lista de ingredientes es obligatoria" })
  ingredientes: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  alergenosPresentes?: string[];

  @IsBoolean()
  @IsOptional()
  esNutricionalmenteSaludable?: boolean;
}
