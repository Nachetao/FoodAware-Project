import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsArray,
  IsEnum,
  MinLength,
} from "class-validator";
import { AllergenCode } from "../../products/contrato/enums";

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: "El nombre es obligatorio" })
  nombre: string;

  @IsEmail({}, { message: "Debe ser un correo electrónico válido" })
  @IsNotEmpty({ message: "El correo es obligatorio" })
  correo: string;

  // Solo en el registro: LoginDto no exige largo mínimo, para que las cuentas
  // creadas antes de esta regla puedan seguir entrando.
  @IsString()
  @IsNotEmpty({ message: "La contraseña (password) es obligatoria" })
  @MinLength(8, {
    message: "La contraseña debe tener al menos 8 caracteres",
  })
  password: string;

  @IsArray()
  @IsEnum(AllergenCode, {
    each: true,
    message: `Cada alergia debe ser uno de estos códigos: ${Object.values(AllergenCode).join(", ")}`,
  })
  @IsOptional()
  alergias?: AllergenCode[];
}
