import { applyDecorators, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerModuleOptions } from "@nestjs/throttler";
import { LimitePeticionesGuard } from "./limite-peticiones.guard";

/** Ventana del límite: las peticiones se cuentan por minuto. */
export const VENTANA_LIMITE_MS = 60_000;

export const LIMITE_LOGIN_POR_DEFECTO = 5;
export const LIMITE_PUBLICO_POR_DEFECTO = 30;

/**
 * Lee un límite de una variable de entorno. Si falta o no es un entero
 * mayor o igual a 1, usa el valor por defecto.
 */
export function leerLimite(
  crudo: string | undefined,
  porDefecto: number,
): number {
  if (crudo === undefined || crudo.trim() === "") {
    return porDefecto;
  }
  const valor = Number(crudo);
  return Number.isInteger(valor) && valor >= 1 ? valor : porDefecto;
}

// Se leen en cada petición, no al importar: un cambio en la variable de
// entorno (o en una prueba) se aplica sin recompilar.
export const LIMITES = {
  /** POST /api/auth/login: frena la fuerza bruta de contraseñas. */
  login: () =>
    leerLimite(process.env.LIMITE_LOGIN_POR_MINUTO, LIMITE_LOGIN_POR_DEFECTO),
  /** Registro, análisis y detalle de producto: frena el abuso, no el uso normal. */
  publico: () =>
    leerLimite(
      process.env.LIMITE_PUBLICO_POR_MINUTO,
      LIMITE_PUBLICO_POR_DEFECTO,
    ),
};

export type TipoLimite = keyof typeof LIMITES;

/**
 * Configuración de ThrottlerModule. El contador vive en memoria: basta con
 * la única instancia del backend en Render (con varias, cada una contaría
 * por su lado).
 */
export const opcionesLimitePeticiones: ThrottlerModuleOptions = {
  throttlers: [{ ttl: VENTANA_LIMITE_MS, limit: LIMITES.publico }],
};

/**
 * Limita la ruta a N peticiones por minuto por IP (la IP real del cliente,
 * gracias a "trust proxy" con SALTOS_PROXY, en proxy-confiable.ts). Cada ruta lleva su propio
 * contador. Al superarlo responde 429 "Demasiados intentos, espera un minuto."
 */
export const LimitarPeticiones = (tipo: TipoLimite) =>
  applyDecorators(
    UseGuards(LimitePeticionesGuard),
    Throttle({ default: { limit: LIMITES[tipo], ttl: VENTANA_LIMITE_MS } }),
  );
