import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { HEADER_REQUEST_ID } from "./products/contrato/request-id";
import { HEADER_FUENTE_DATOS } from "./products/fuente-datos";
import { Logger } from "nestjs-pino";
import { requestIdMiddleware } from "./observabilidad/request-id";

async function bootstrap() {
  // bufferLogs: los logs del arranque esperan al logger de pino.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Todos los Logger de NestJS escriben en JSON con el formato acordado.
  app.useLogger(app.get(Logger));
  // Primero que todo: el request id queda disponible para el resto de la petición.
  app.use(requestIdMiddleware);
  // Todas las rutas estarán bajo el prefijo /api
  app.setGlobalPrefix("api");
  // Se habilitan los CORS por defecto para el MVP. Los headers expuestos son
  // los que el frontend necesita leer de la respuesta.
  app.enableCors({ exposedHeaders: [HEADER_REQUEST_ID, HEADER_FUENTE_DATOS] });

  // Activar validación global para los DTOs
  // whitelist + forbidNonWhitelisted: un campo que no está en el DTO se
  // rechaza con 400 (evita asignar id, password u otros campos a escondidas).
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle("FoodAware Backend")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  await app.listen(3000);
}
bootstrap();
