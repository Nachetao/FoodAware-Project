import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

/** Usuario autenticado, tal como queda en req.user. */
export interface UsuarioToken {
  id: string;
  correo: string;
}

interface PayloadJwt {
  sub: string;
  correo: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Mismo secreto con el que AuthService firma en el login.
      secretOrKey: configService.getOrThrow<string>("JWT_SECRET"),
    });
  }

  validate(payload: PayloadJwt): UsuarioToken {
    return { id: payload.sub, correo: payload.correo };
  }
}
