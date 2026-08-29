import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFoodDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del alimento es obligatorio' })
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  @Type(() => Number) // Convierte el input a Number automáticamente
  quantity: number;

  @IsDateString({}, { message: 'La fecha de expiración debe ser una fecha válida (YYYY-MM-DD)' })
  @IsNotEmpty()
  expirationDate: string;
}
