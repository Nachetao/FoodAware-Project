import { ApiProperty } from "@nestjs/swagger";
import { CodigoError } from "./enums";

export class DetalleError {
  @ApiProperty({
    enum: CodigoError,
    enumName: "CodigoError",
    example: CodigoError.NOT_FOUND,
  })
  codigo: CodigoError;

  @ApiProperty({
    minLength: 1,
    example: "Producto 7802800716999 no encontrado",
  })
  mensaje: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 128,
    description: "Valor del header X-Request-ID de la petición.",
    example: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
  })
  request_id: string;
}

/** Cuerpo de error del contrato: {"error": {codigo, mensaje, request_id}}. */
export class ErrorContrato {
  @ApiProperty({ type: () => DetalleError })
  error: DetalleError;
}

const CODIGOS_ERROR = new Set<string>(Object.values(CodigoError));

export function esErrorContrato(cuerpo: unknown): cuerpo is ErrorContrato {
  const error = (cuerpo as ErrorContrato)?.error;
  return (
    typeof error === "object" &&
    error !== null &&
    CODIGOS_ERROR.has(error.codigo) &&
    typeof error.mensaje === "string" &&
    typeof error.request_id === "string"
  );
}
