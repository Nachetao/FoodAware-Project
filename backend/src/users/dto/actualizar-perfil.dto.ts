import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { AllergenCode, DietLabel } from "../../products/contrato/enums";

/**
 * PATCH /api/usuarios/me: solo cambia los campos que vienen. El rol, el
 * correo y la contraseña no se pueden cambiar aquí (forbidNonWhitelisted
 * responde 400 si vienen).
 */
export class ActualizarPerfilDto {
  @ApiPropertyOptional({ example: "Ana", maxLength: 100 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString({ message: "nombre debe ser texto" })
  @IsNotEmpty({ message: "El nombre no puede quedar vacío" })
  @MaxLength(100, { message: "El nombre no puede tener más de 100 caracteres" })
  nombre?: string;

  @ApiPropertyOptional({
    enum: AllergenCode,
    enumName: "AllergenCode",
    isArray: true,
    description: "Reemplaza todas las alergias; [] las borra.",
    example: [AllergenCode.MANI],
  })
  @IsOptional()
  @IsArray({ message: "alergias debe ser una lista" })
  @IsEnum(AllergenCode, {
    each: true,
    message: `Cada alergia debe ser uno de estos códigos: ${Object.values(AllergenCode).join(", ")}`,
  })
  alergias?: AllergenCode[];

  @ApiPropertyOptional({
    enum: DietLabel,
    enumName: "DietLabel",
    isArray: true,
    description: "Reemplaza todas las dietas; [] las borra.",
    example: [DietLabel.VEGETARIANO],
  })
  @IsOptional()
  @IsArray({ message: "dietas debe ser una lista" })
  @IsEnum(DietLabel, {
    each: true,
    message: `Cada dieta debe ser uno de estos códigos: ${Object.values(DietLabel).join(", ")}`,
  })
  dietas?: DietLabel[];

  @ApiPropertyOptional({
    description:
      "true: las trazas, los indicios y los datos insuficientes hacen el producto no apto en vez de apto con advertencia.",
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: "modo_estricto debe ser true o false" })
  modo_estricto?: boolean;
}
