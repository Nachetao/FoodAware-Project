import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { UsuarioActual } from "../auth/decoradores";
import { UsuarioToken } from "../auth/jwt.strategy";
import { ActualizarAlergiasDto } from "./dto/actualizar-alergias.dto";
import { ActualizarPerfilDto } from "./dto/actualizar-perfil.dto";
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
  @ApiOkResponse({
    description: "id, nombre, correo, alergias, dietas, modo_estricto y rol.",
  })
  perfil(@UsuarioActual() usuario: UsuarioToken): Promise<UsuarioPublico> {
    return this.usersService.perfil(usuario.id);
  }

  @Patch()
  @ApiOperation({
    summary: "Edita el perfil del usuario autenticado",
    description:
      "Cambia solo los campos que vienen: nombre, alergias (AllergenCode), dietas (DietLabel) y modo_estricto. El correo, la contraseña y el rol no se pueden cambiar aquí.",
  })
  @ApiOkResponse({ description: "Perfil actualizado." })
  @ApiBadRequestResponse({
    description: "Un campo no es válido o no se puede cambiar.",
  })
  actualizarPerfil(
    @UsuarioActual() usuario: UsuarioToken,
    @Body() cambios: ActualizarPerfilDto,
  ): Promise<UsuarioPublico> {
    return this.usersService.actualizarPerfil(usuario.id, cambios);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Borra la cuenta del usuario autenticado y sus datos",
    description:
      "Borra al usuario (nombre, correo, contraseña, alergias, dietas y modo estricto). Desde ese momento su token responde 401.",
  })
  @ApiNoContentResponse({ description: "Cuenta borrada." })
  async borrarCuenta(@UsuarioActual() usuario: UsuarioToken): Promise<void> {
    await this.usersService.borrarCuenta(usuario.id);
  }

  @Put("alergias")
  @ApiOperation({
    summary: "Reemplaza las alergias del usuario autenticado (obsoleto)",
    description:
      "Obsoleto: usar PATCH /api/usuarios/me. Cada alergia debe ser un código AllergenCode del contrato.",
    deprecated: true,
  })
  @ApiOkResponse({ description: "Perfil con las alergias actualizadas." })
  actualizarAlergias(
    @UsuarioActual() usuario: UsuarioToken,
    @Body() { alergias }: ActualizarAlergiasDto,
  ): Promise<UsuarioPublico> {
    return this.usersService.actualizarAlergias(usuario.id, alergias);
  }
}
