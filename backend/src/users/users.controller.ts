import { Controller, Post, Body } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Responde el usuario sin password; 409 si el correo ya existe.
  @Post()
  async createTestUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.createTestUser(createUserDto);
  }
}
