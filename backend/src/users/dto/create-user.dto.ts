import { IsString, IsNotEmpty, IsEmail, IsOptional, IsArray } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  nombre: string;

  @IsEmail({}, { message: 'Debe ser un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo es obligatorio' })
  correo: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña (password) es obligatoria' })
  password: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  alergias?: string[];
}
