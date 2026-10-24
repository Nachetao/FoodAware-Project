import {
  ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Request } from "express";
import { UsuarioToken } from "./jwt.strategy";

export const ES_PUBLICA = "esPublica";

/**
 * Marca una ruta (o un controlador) como pública: no exige token. Si la
 * petición trae uno válido, igual queda disponible con @UsuarioActual().
 */
export const Public = () => SetMetadata(ES_PUBLICA, true);

/** Usuario del token, o null si la ruta es pública y no vino uno válido. */
export const UsuarioActual = createParamDecorator(
  (_dato: unknown, context: ExecutionContext): UsuarioToken | null =>
    (context.switchToHttp().getRequest<Request>().user as UsuarioToken) ?? null,
);
