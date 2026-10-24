import { Controller, Post, Body } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { Public } from "../auth/decoradores";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Registro, público. Responde el usuario sin password; 409 si el correo ya existe.
  @Public()
  @Post()
  async createTestUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createTestUser(createUserDto);
  }
}
