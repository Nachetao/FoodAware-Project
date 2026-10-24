import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { MetricasController } from "./metricas.controller";

// Reutiliza el cliente de FastAPI que exporta ProductsModule.
@Module({
  imports: [ProductsModule],
  controllers: [MetricasController],
})
export class MetricasModule {}
