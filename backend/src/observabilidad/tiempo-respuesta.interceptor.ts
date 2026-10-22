import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Request, Response } from "express";
import { PinoLogger } from "nestjs-pino";
import { Observable, tap } from "rxjs";

export const HEADER_TIEMPO_RESPUESTA = "X-Response-Time-ms";

const ms = (inicio: number) => performance.now() - inicio;

/**
 * Igual que FastAPI: header X-Response-Time-ms (tiempo hasta enviar los
 * headers, con 3 decimales) y un log "acceso_http" por petición.
 */
@Injectable()
export class TiempoRespuestaInterceptor implements NestInterceptor {
  constructor(private readonly pinoLogger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const inicio = performance.now();
    // Logger ya ligado al request_id: el evento finish puede correr fuera del
    // contexto de la petición.
    const log = this.pinoLogger.logger;

    res.once("finish", () => {
      const duracion = Math.round(ms(inicio) * 1000) / 1000;
      log.info(
        {
          logger: "AccesoHttp",
          evento: "acceso_http",
          metodo: req.method,
          ruta: req.path,
          codigo_estado: res.statusCode,
          duracion_ms: duracion,
        },
        `${req.method} ${req.path} ${res.statusCode} en ${duracion.toFixed(1)} ms`,
      );
    });

    // También ante errores: el filtro de excepciones responde después.
    const marcarTiempo = () => {
      if (!res.headersSent) {
        res.setHeader(HEADER_TIEMPO_RESPUESTA, ms(inicio).toFixed(3));
      }
    };
    return next.handle().pipe(tap({ next: marcarTiempo, error: marcarTiempo }));
  }
}
