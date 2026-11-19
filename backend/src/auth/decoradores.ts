import {
  ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Request } from "express";
import { UsuarioToken } from "./jwt.strategy";
import { Rol } from "../users/rol";

export const ES_PUBLICA = "esPublica";
export const ROLES = "roles";

/**
 * Marca una ruta (o un controlador) como pública: no exige token. Si la
 * petición trae uno válido, igual queda disponible con @UsuarioActual().
 */
export const Public = () => SetMetadata(ES_PUBLICA, true);

/**
 * Restringe una ruta (o un controlador) a ciertos roles; RolesGuard responde
 * 403 a los demás. Sin @Roles basta con un token válido.
 */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

/** Usuario del token, o null si la ruta es pública y no vino uno válido. */
export const UsuarioActual = createParamDecorator(
  (_dato: unknown, context: ExecutionContext): UsuarioToken | null =>
    (context.switchToHttp().getRequest<Request>().user as UsuarioToken) ?? null,
);
