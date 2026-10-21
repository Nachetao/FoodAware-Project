import { HttpException } from "@nestjs/common";
import { CodigoError } from "./contrato/enums";
import { ErrorContrato } from "./contrato/error";

/** Error HTTP cuyo cuerpo sigue el formato de error del contrato. */
export class ContratoHttpException extends HttpException {
  constructor(status: number, cuerpo: ErrorContrato) {
    super(cuerpo, status);
  }

  static crear(
    status: number,
    codigo: CodigoError,
    mensaje: string,
    requestId: string,
  ): ContratoHttpException {
    return new ContratoHttpException(status, {
      error: { codigo, mensaje, request_id: requestId },
    });
  }
}
