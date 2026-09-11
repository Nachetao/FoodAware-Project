import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class LoginDto {
  @IsEmail({}, { message: "Debe ser un correo electrónico válido" })
  @IsNotEmpty({ message: "El correo es obligatorio" })
  correo: string;

  @IsString()
  @IsNotEmpty({ message: "La contraseña es obligatoria" })
  password: string;
}
