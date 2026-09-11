import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UsersService } from "../users/users.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    correo: string,
    password: string,
  ): Promise<{ access_token: string }> {
    const user = await this.usersService.findByCorreo(correo);

    if (!user) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const payload = { sub: user.id, correo: user.correo };

    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
