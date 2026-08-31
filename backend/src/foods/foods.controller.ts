import { Controller, Get } from "@nestjs/common";
import { FoodsService } from "./foods.service";

// Dado que en main.ts ya tenemos app.setGlobalPrefix('api'),
// usar @Controller('food') hará que la ruta final sea /api/food
@Controller("food")
export class FoodsController {
  constructor(private readonly foodsService: FoodsService) {}

  @Get()
  async findAll() {
    return this.foodsService.findAll();
  }
}
