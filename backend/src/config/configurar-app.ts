import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { HEADER_REQUEST_ID } from "../products/contrato/request-id";
import { HEADER_FUENTE_DATOS } from "../products/fuente-datos";
import { requestIdMiddleware } from "../observabilidad/request-id";
import { origenesCors } from "./despliegue";

/**
 * Configuración global de la app, compartida por main.ts y las pruebas de
 * integración para que estas prueben exactamente lo mismo que producción.
 */
export function configurarApp(app: INestApplication): void {
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
  // whitelist + forbidNonWhitelisted: un campo que no está en el DTO se
  // rechaza con 400 (evita asignar id, password u otros campos a escondidas).
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
