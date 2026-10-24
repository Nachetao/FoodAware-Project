import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { puerto } from "./config/despliegue";
import { configurarApp } from "./config/configurar-app";

async function bootstrap() {
  // bufferLogs: los logs del arranque esperan al logger de pino.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Logger, request id, prefijo /api, CORS y validación (compartido con las
  // pruebas de integración).
  configurarApp(app);

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
