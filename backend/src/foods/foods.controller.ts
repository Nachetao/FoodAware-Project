import { Controller, Get } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { FoodsService } from "./foods.service";
import { Roles } from "../auth/decoradores";
import { Rol } from "../users/rol";

// Dado que en main.ts ya tenemos app.setGlobalPrefix('api'),
// usar @Controller('food') hará que la ruta final sea /api/food
@Controller("food")
export class FoodsController {
  constructor(private readonly foodsService: FoodsService) {}

  @Get()
  @Roles(Rol.ADMINISTRADOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Lista completa de alimentos analizados (solo administradores)",
  })
  @ApiUnauthorizedResponse({ description: "Falta el token o no es válido." })
  @ApiForbiddenResponse({ description: "El usuario no es administrador." })
  async findAll() {
    return this.foodsService.findAll();
  }
}
