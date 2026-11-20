import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Request } from "express";
import { requestIdDe } from "../observabilidad/request-id";

/** Mensaje del 429, el mismo en todas las rutas con límite. */
export const MENSAJE_LIMITE = "Demasiados intentos, espera un minuto.";

/**
 * 429 con el formato por defecto de NestJS, el mismo del 401 del login y el
 * 409 del registro. En /api/products, ContratoExceptionFilter lo pasa al
 * formato del contrato (TOO_MANY_REQUESTS).
 */
export class DemasiadasPeticionesException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: MENSAJE_LIMITE,
        error: "Too Many Requests",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * ThrottlerGuard con la respuesta y el log de FoodAware. Identifica al
 * cliente por req.ip, que con "trust proxy" es la IP real y no la del proxy
 * de Render.
 */
@Injectable()
export class LimitePeticionesGuard extends ThrottlerGuard {
  private readonly log = new Logger(LimitePeticionesGuard.name);

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Request>();
    // Sin la IP ni el cuerpo (puede traer la contraseña): solo la ruta.
    this.log.warn(
      `[${requestIdDe(req)}] limite_peticiones_superado en ${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
    );
    throw new DemasiadasPeticionesException();
  }
}
