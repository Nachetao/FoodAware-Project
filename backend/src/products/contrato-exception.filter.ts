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
import { resolverRequestId } from "./resolver-request-id";

/**
 * Responde los errores de ProductsController con el formato del contrato.
 * Los 400 del ValidationPipe pasan a 422 VALIDATION_ERROR, igual que FastAPI.
 */
@Catch(ContratoHttpException, BadRequestException)
export class ContratoExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const requestId = resolverRequestId(ctx.getRequest<Request>());
    const error =
      exception instanceof ContratoHttpException
        ? exception
        : ContratoHttpException.crear(
            HttpStatus.UNPROCESSABLE_ENTITY,
            CodigoError.VALIDATION_ERROR,
            `Solicitud inválida: ${this.detallesValidacion(exception)}`,
            requestId,
          );

    ctx
      .getResponse<Response>()
      .setHeader(HEADER_REQUEST_ID, requestId)
      .status(error.getStatus())
      .json(error.getResponse());
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
