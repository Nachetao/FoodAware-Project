import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Rol } from "../users/rol";
import { ROLES } from "./decoradores";
import { UsuarioToken } from "./jwt.strategy";

/**
 * Guard global, después de JwtAuthGuard: si la ruta tiene @Roles, el rol del
 * usuario (ya comparado con la base en JwtStrategy) debe estar entre ellos.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }
    const usuario = context.switchToHttp().getRequest<Request>().user as
      UsuarioToken | null | undefined;
    // Solo pasa si una ruta con @Roles también fuera @Public sin token.
    if (!usuario) {
      throw new UnauthorizedException();
    }
    if (!roles.includes(usuario.rol)) {
      throw new ForbiddenException("No tienes permiso para esta acción");
    }
    return true;
  }
}
