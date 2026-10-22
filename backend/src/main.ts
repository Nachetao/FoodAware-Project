import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { HEADER_REQUEST_ID } from "./products/contrato/request-id";
import { HEADER_FUENTE_DATOS } from "./products/fuente-datos";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Todas las rutas estarán bajo el prefijo /api
  app.setGlobalPrefix("api");
  // Se habilitan los CORS por defecto para el MVP. Los headers expuestos son
  // los que el frontend necesita leer de la respuesta.
  app.enableCors({ exposedHeaders: [HEADER_REQUEST_ID, HEADER_FUENTE_DATOS] });

  // Activar validación global para los DTOs
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const config = new DocumentBuilder()
    .setTitle("FoodAware Backend")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  await app.listen(3000);
}
bootstrap();
