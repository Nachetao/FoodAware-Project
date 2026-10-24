import { Body, Controller, Get, Put } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { UsuarioActual } from "../auth/decoradores";
import { UsuarioToken } from "../auth/jwt.strategy";
import { ActualizarAlergiasDto } from "./dto/actualizar-alergias.dto";
import { UsuarioPublico, UsersService } from "./users.service";

/** Perfil del usuario autenticado (requiere JWT). */
@ApiTags("usuarios")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Falta el token o no es válido." })
@ApiNotFoundResponse({ description: "El usuario del token ya no existe." })
@Controller("usuarios/me")
export class UsuariosController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: "Perfil del usuario autenticado (sin password)" })
  @ApiOkResponse({ description: "id, nombre, correo y alergias." })
  perfil(@UsuarioActual() usuario: UsuarioToken): Promise<UsuarioPublico> {
    return this.usersService.perfil(usuario.id);
  }

  @Put("alergias")
  @ApiOperation({
    summary: "Reemplaza las alergias del usuario autenticado",
    description: "Cada alergia debe ser un código AllergenCode del contrato.",
  })
  @ApiOkResponse({ description: "Perfil con las alergias actualizadas." })
  actualizarAlergias(
    @UsuarioActual() usuario: UsuarioToken,
    @Body() { alergias }: ActualizarAlergiasDto,
  ): Promise<UsuarioPublico> {
    return this.usersService.actualizarAlergias(usuario.id, alergias);
  }
}
