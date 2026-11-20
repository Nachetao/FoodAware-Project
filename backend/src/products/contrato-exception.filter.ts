import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { CodigoError } from "./contrato/enums";
import { HEADER_REQUEST_ID } from "./contrato/request-id";
import { ContratoHttpException } from "./contrato-http.exception";
import { requestIdDe } from "../observabilidad/request-id";
import {
  DemasiadasPeticionesException,
  MENSAJE_LIMITE,
} from "../seguridad/limite-peticiones.guard";

/**
 * Responde los errores de ProductsController con el formato del contrato.
 * Los 400 del ValidationPipe pasan a 422 VALIDATION_ERROR, igual que FastAPI,
 * y el 429 del límite de peticiones, a TOO_MANY_REQUESTS.
 */
@Catch(
  ContratoHttpException,
  BadRequestException,
  DemasiadasPeticionesException,
)
export class ContratoExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const requestId = requestIdDe(ctx.getRequest<Request>());
    const error = this.aContrato(exception, requestId);

    ctx
      .getResponse<Response>()
      .setHeader(HEADER_REQUEST_ID, requestId)
      .status(error.getStatus())
      .json(error.getResponse());
  }

  private aContrato(
    exception: HttpException,
    requestId: string,
  ): ContratoHttpException {
    if (exception instanceof ContratoHttpException) {
      return exception;
    }
    if (exception instanceof DemasiadasPeticionesException) {
      return ContratoHttpException.crear(
        HttpStatus.TOO_MANY_REQUESTS,
        CodigoError.TOO_MANY_REQUESTS,
        MENSAJE_LIMITE,
        requestId,
      );
    }
    return ContratoHttpException.crear(
      HttpStatus.UNPROCESSABLE_ENTITY,
      CodigoError.VALIDATION_ERROR,
      `Solicitud inválida: ${this.detallesValidacion(exception)}`,
      requestId,
    );
  }

  private detallesValidacion(exception: BadRequestException): string {
    const { message } = exception.getResponse() as {
      message?: string | string[];
    };
    if (Array.isArray(message)) {
      return message.join("; ");
    }
    return message ?? exception.message;
  }
}
