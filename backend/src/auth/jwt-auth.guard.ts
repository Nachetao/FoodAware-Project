import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ES_PUBLICA } from "./decoradores";

/**
 * Guard global: toda ruta exige un JWT válido salvo las marcadas con
 * @Public(). En las públicas también se lee el token si viene, pero sin
 * exigirlo: uno ausente o inválido deja req.user en null.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<T>(
    error: unknown,
    usuario: T,
    _info: unknown,
    context: ExecutionContext,
  ): T | null {
    if (this.esPublica(context)) {
      return usuario || null;
    }
    if (error || !usuario) {
      throw error instanceof Error ? error : new UnauthorizedException();
    }
    return usuario;
  }

  private esPublica(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(ES_PUBLICA, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
