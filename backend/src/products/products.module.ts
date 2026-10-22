import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Product } from "./entities/product.entity";
import { FastApiClientService } from "./fastapi-client.service";
import { TIMEOUT_FASTAPI_MS_POR_DEFECTO, leerEntero } from "./fastapi.config";
import { ProductsController } from "./products.controller";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

@Module({
  imports: [
    // Timeout por intento; los reintentos los maneja FastApiClientService.
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: leerEntero(
          config,
          "PYTHON_API_TIMEOUT_MS",
          TIMEOUT_FASTAPI_MS_POR_DEFECTO,
          1,
        ),
      }),
    }),
    TypeOrmModule.forFeature([Product]),
  ],
  controllers: [ProductsController],
  providers: [FastApiClientService, ProductsRepository, ProductsService],
  exports: [FastApiClientService],
})
export class ProductsModule {}
