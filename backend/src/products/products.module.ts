import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Product } from "./entities/product.entity";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsController } from "./products.controller";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

// Los reintentos y el respaldo ante fallas de FastAPI llegan en el punto 4.
const TIMEOUT_FASTAPI_MS = 5000;

@Module({
  imports: [
    HttpModule.register({ timeout: TIMEOUT_FASTAPI_MS }),
    TypeOrmModule.forFeature([Product]),
  ],
  controllers: [ProductsController],
  providers: [FastApiClientService, ProductsRepository, ProductsService],
  exports: [FastApiClientService],
})
export class ProductsModule {}
