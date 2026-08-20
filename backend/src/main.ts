import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Todas las rutas estarán bajo el prefijo /api
  app.setGlobalPrefix('api');
  // Se habilitan los CORS por defecto para el MVP
  app.enableCors();
  await app.listen(3000);
}
bootstrap();
