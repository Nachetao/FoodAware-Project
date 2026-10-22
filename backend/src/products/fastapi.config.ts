import { ConfigService } from "@nestjs/config";

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
