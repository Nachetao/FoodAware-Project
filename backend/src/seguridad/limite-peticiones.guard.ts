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
import { diagnosticarProxy, diagnosticoProxyActivo } from "./diagnostico-proxy";
import { ipCliente } from "./ip-cliente";

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
 * cliente por CF-Connecting-IP cuando viene y es válido (IP_DESDE_CLOUDFLARE),
 * y si no, por req.ip con "trust proxy" (SALTOS_PROXY). Ver ip-cliente.ts.
 */
@Injectable()
export class LimitePeticionesGuard extends ThrottlerGuard {
  private readonly log = new Logger(LimitePeticionesGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Solo con DIAGNOSTICO_PROXY=true: un log sin IPs para ajustar
    // SALTOS_PROXY (ver diagnostico-proxy.ts).
    if (diagnosticoProxyActivo()) {
      const req = context.switchToHttp().getRequest<Request>();
      this.log.log(
        diagnosticarProxy(req),
        `[${requestIdDe(req)}] diagnostico_proxy en ${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`,
      );
    }
    return super.canActivate(context);
  }

  /**
   * La IP de ipCliente pasa por el getTracker original, que agrupa las IPv6
   * por su prefijo /64 (un mismo cliente puede rotar dentro de él).
   */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return super.getTracker({ ip: ipCliente(req as unknown as Request).ip });
  }

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
