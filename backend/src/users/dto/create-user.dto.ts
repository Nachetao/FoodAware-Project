import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsArray,
  IsEnum,
} from "class-validator";
import { AllergenCode } from "../../products/contrato/enums";

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: "El nombre es obligatorio" })
  nombre: string;

  @IsEmail({}, { message: "Debe ser un correo electrónico válido" })
  @IsNotEmpty({ message: "El correo es obligatorio" })
  correo: string;

  @IsString()
  @IsNotEmpty({ message: "La contraseña (password) es obligatoria" })
  password: string;

  @IsArray()
  @IsEnum(AllergenCode, {
    each: true,
    message: `Cada alergia debe ser uno de estos códigos: ${Object.values(AllergenCode).join(", ")}`,
  })
  @IsOptional()
  alergias?: AllergenCode[];
}
