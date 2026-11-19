import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Rol } from "../users/rol";
import { UsersService } from "../users/users.service";

/** Usuario autenticado, tal como queda en req.user. */
export interface UsuarioToken {
  id: string;
  correo: string;
  rol: Rol;
}

/** Lo que AuthService firma en el login. */
export interface PayloadJwt {
  sub: string;
  correo: string;
  rol: Rol;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Mismo secreto con el que AuthService firma en el login.
      secretOrKey: configService.getOrThrow<string>("JWT_SECRET"),
    });
  }

  /**
   * En cada petición: el usuario del token debe existir y tener el mismo rol
   * que el token. Si borró su cuenta o le cambiaron el rol, el token deja de
   * servir (401) y hay que volver a iniciar sesión.
   */
  async validate(payload: PayloadJwt): Promise<UsuarioToken> {
    const usuario = await this.usersService.buscarPorId(payload.sub);
    if (!usuario || usuario.rol !== payload.rol) {
      throw new UnauthorizedException();
    }
    return { id: usuario.id, correo: usuario.correo, rol: usuario.rol };
  }
}
