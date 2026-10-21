import { randomUUID } from "crypto";
import { Request } from "express";
import { FORMATO_REQUEST_ID } from "./contrato/request-id";

// Se recuerda por petición para que el controlador y el filtro de errores
// usen el mismo ID. En el punto 6 esto pasa a un middleware.
const idsPorPeticion = new WeakMap<Request, string>();

/** Reutiliza un X-Request-ID entrante válido o genera un uuid4. */
export function resolverRequestId(req: Request): string {
  let requestId = idsPorPeticion.get(req);
  if (!requestId) {
    const recibido = req.headers["x-request-id"];
    requestId =
      typeof recibido === "string" && FORMATO_REQUEST_ID.test(recibido)
        ? recibido
        : randomUUID();
    idsPorPeticion.set(req, requestId);
  }
  return requestId;
}
