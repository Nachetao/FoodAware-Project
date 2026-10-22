import { Params } from "nestjs-pino";
import { LoggerOptions } from "pino";
import { requestIdActual } from "./request-id";

export const SERVICIO = "backend";

// Mismos nombres de nivel que FastAPI (Python usa "warning").
const NIVELES: Record<string, string> = { warn: "warning" };

/**
 * Formato acordado con FastAPI, una línea JSON por evento: timestamp (ISO
 * 8601 UTC), level, service, request_id y message. pino siempre escribe
 * level primero; el resto de los campos va en el orden acordado.
 */
export const opcionesPino: LoggerOptions = {
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  // Reemplaza pid y hostname.
  base: { service: SERVICIO },
  formatters: {
    level: (nivel) => ({ level: NIVELES[nivel] ?? nivel }),
  },
  // Dentro de una petición, pino-http ya liga request_id al logger; fuera
  // (arranque, tareas) se toma del contexto, o null. Así nunca sale repetido.
  mixin: (_objeto, _nivel, logger) =>
    "request_id" in logger.bindings() ? {} : { request_id: requestIdActual() },
};

export const configuracionLogger: Params = {
  pinoHttp: {
    ...opcionesPino,
    // El id ya lo fijó requestIdMiddleware.
    genReqId: (req) => req.id,
    // El log por petición llega con el interceptor de tiempo de respuesta.
    autoLogging: false,
    // El logger de cada petición solo liga el id, con el nombre acordado.
    quietReqLogger: true,
    customAttributeKeys: { reqId: "request_id" },
  },
  // Igual que el campo "logger" de FastAPI.
  renameContext: "logger",
};
