import { Controller, Post, Body } from "@nestjs/common";
import { ApiTooManyRequestsResponse } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { Public } from "../auth/decoradores";
import { LimitarPeticiones } from "../seguridad/limite-peticiones";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Registro, público. Responde el usuario sin password; 409 si el correo ya existe.
  // Limitado por IP contra la creación de cuentas en masa.
  @Public()
  @LimitarPeticiones("publico")
  @Post()
  @ApiTooManyRequestsResponse({
    description: "Demasiados registros desde la misma IP en un minuto.",
  })
  async createTestUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createTestUser(createUserDto);
  }
}
