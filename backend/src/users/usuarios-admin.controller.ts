import { Controller, Get } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Roles } from "../auth/decoradores";
import { Rol } from "./rol";
import { UsersService, UsuarioResumen } from "./users.service";

/** Administración de usuarios (solo rol administrador). */
@ApiTags("usuarios")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Falta el token o no es válido." })
@ApiForbiddenResponse({ description: "El usuario no es administrador." })
@Roles(Rol.ADMINISTRADOR)
@Controller("usuarios")
export class UsuariosAdminController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: "Lista de usuarios (solo administradores)",
    description:
      "id, nombre, correo y rol de cada usuario. Sin contraseña ni datos de salud (alergias).",
  })
  @ApiOkResponse({ description: "Usuarios ordenados por nombre." })
  listar(): Promise<UsuarioResumen[]> {
    return this.usersService.listar();
  }
}
