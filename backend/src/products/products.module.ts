import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { FastApiClientService } from "./fastapi-client.service";

// Los reintentos y el respaldo ante fallas de FastAPI llegan en el punto 4.
const TIMEOUT_FASTAPI_MS = 5000;

@Module({
  imports: [HttpModule.register({ timeout: TIMEOUT_FASTAPI_MS })],
  providers: [FastApiClientService],
  exports: [FastApiClientService],
})
export class ProductsModule {}
