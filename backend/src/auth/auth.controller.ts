import { Controller, Post, Body } from "@nestjs/common";
import { ApiTooManyRequestsResponse } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { Public } from "./decoradores";
import { LimitarPeticiones } from "../seguridad/limite-peticiones";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Contra la fuerza bruta: LIMITE_LOGIN_POR_MINUTO intentos por IP (5 por defecto).
  @LimitarPeticiones("login")
  @Post("login")
  @ApiTooManyRequestsResponse({
    description: "Demasiados intentos desde la misma IP en un minuto.",
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.correo, loginDto.password);
  }
}
