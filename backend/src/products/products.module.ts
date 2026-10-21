import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsController } from "./products.controller";

// Los reintentos y el respaldo ante fallas de FastAPI llegan en el punto 4.
const TIMEOUT_FASTAPI_MS = 5000;

@Module({
  imports: [HttpModule.register({ timeout: TIMEOUT_FASTAPI_MS })],
  controllers: [ProductsController],
  providers: [FastApiClientService],
  exports: [FastApiClientService],
})
export class ProductsModule {}
