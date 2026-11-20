import { ConfigService } from "@nestjs/config";
import { HEADER_REQUEST_ID } from "./contrato/request-id";

// Valores por defecto de las llamadas a FastAPI. /search responde en
// milisegundos, así que 2 s por intento ya indica un problema.
// Peor caso: 3 intentos × 2 s + esperas (~0.85 s) ≈ 7 s antes del respaldo.
export const TIMEOUT_FASTAPI_MS_POR_DEFECTO = 2000;
export const REINTENTOS_FASTAPI_POR_DEFECTO = 2;

/**
 * Lee un entero de la configuración. Si falta, está vacío o no es un entero
 * mayor o igual a `minimo`, usa el valor por defecto.
 */
export function leerEntero(
  config: ConfigService,
  clave: string,
  porDefecto: number,
  minimo = 0,
): number {
  const crudo = config.get<string | number>(clave);
  if (crudo === undefined || crudo === null || crudo === "") {
    return porDefecto;
  }
  const valor = Number(crudo);
  return Number.isInteger(valor) && valor >= minimo ? valor : porDefecto;
}

/** Header con la clave entre servicios que exige FastAPI (CLAVE_SERVICIO). */
export const HEADER_CLAVE_SERVICIO = "X-Clave-Servicio";

/**
 * Headers comunes de las llamadas a FastAPI: X-Request-ID y X-Clave-Servicio
 * (de CLAVE_SERVICIO). La clave es obligatoria en staging y en Docker Compose
 * (CLAVE_SERVICIO_OBLIGATORIA=true, también por defecto en FastAPI): si falta
 * o no coincide, FastAPI responde 403 y el backend usa su respaldo. Con la
 * variable vacía no se envía el header; eso solo funciona si FastAPI quedó con
 * CLAVE_SERVICIO_OBLIGATORIA=false, como vuelta atrás de emergencia.
 */
export function headersFastApi(
  config: ConfigService,
  requestId?: string,
): Record<string, string> {
  const clave = config.get<string>("CLAVE_SERVICIO")?.trim();
  return {
    ...(requestId !== undefined && { [HEADER_REQUEST_ID]: requestId }),
    ...(clave && { [HEADER_CLAVE_SERVICIO]: clave }),
  };
}
