import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { HEADER_REQUEST_ID } from "./products/contrato/request-id";
import { HEADER_FUENTE_DATOS } from "./products/fuente-datos";
import { Logger } from "nestjs-pino";
import { requestIdMiddleware } from "./observabilidad/request-id";
import { origenesCors, puerto } from "./config/despliegue";

async function bootstrap() {
  // bufferLogs: los logs del arranque esperan al logger de pino.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Todos los Logger de NestJS escriben en JSON con el formato acordado.
  app.useLogger(app.get(Logger));
  // Primero que todo: el request id queda disponible para el resto de la petición.
  app.use(requestIdMiddleware);
  // Todas las rutas estarán bajo el prefijo /api
  app.setGlobalPrefix("api");
  // CORS solo para los orígenes de CORS_ORIGINS (en local, los de desarrollo).
  // Los headers expuestos son los que el frontend necesita leer de la respuesta.
  app.enableCors({
    origin: origenesCors(process.env.CORS_ORIGINS),
    exposedHeaders: [HEADER_REQUEST_ID, HEADER_FUENTE_DATOS],
  });

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
    .setDescription(
      "Las rutas exigen un JWT (Authorization: Bearer <token>, de POST /api/auth/login) salvo las públicas: GET /api/health, POST /api/auth/login, POST /api/users, GET /api/products/search y POST /api/food/analizar (token opcional).",
    )
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  // Swagger (/docs) queda expuesto también en staging, a propósito, para la evaluación.
  await app.listen(puerto(process.env.PORT));
}
bootstrap();
