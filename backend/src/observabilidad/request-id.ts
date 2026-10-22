import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import {
  FORMATO_REQUEST_ID,
  HEADER_REQUEST_ID,
} from "../products/contrato/request-id";

// Request id de la petición en curso, disponible para los logs sin pasarlo a mano.
const contexto = new AsyncLocalStorage<string>();

/** Request id de la petición en curso; null fuera de una petición. */
export function requestIdActual(): string | null {
  return contexto.getStore() ?? null;
}

/**
 * Request id de la petición: reutiliza un X-Request-ID entrante válido o
 * genera un uuid4. Se guarda en req.id, así controlador, filtro y logs leen
 * el mismo valor aunque el middleware no haya corrido (por ejemplo, en tests).
 */
export function requestIdDe(req: Request): string {
  if (typeof req.id !== "string") {
    const recibido = req.headers["x-request-id"];
    req.id =
      typeof recibido === "string" && FORMATO_REQUEST_ID.test(recibido)
        ? recibido
        : randomUUID();
  }
  return req.id as string;
}

/** Middleware global: fija el request id, lo devuelve en la respuesta y abre su contexto. */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = requestIdDe(req);
  res.setHeader(HEADER_REQUEST_ID, requestId);
  contexto.run(requestId, next);
}
