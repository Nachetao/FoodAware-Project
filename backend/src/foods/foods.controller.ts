import { Controller, Get } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { FoodsService } from "./foods.service";

// Dado que en main.ts ya tenemos app.setGlobalPrefix('api'),
// usar @Controller('food') hará que la ruta final sea /api/food
@Controller("food")
export class FoodsController {
  constructor(private readonly foodsService: FoodsService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Lista completa de alimentos analizados (requiere token)",
  })
  @ApiUnauthorizedResponse({ description: "Falta el token o no es válido." })
  async findAll() {
    return this.foodsService.findAll();
  }
}
