import { INestApplication, Logger } from "@nestjs/common";

/**
 * Proxies delante del backend en Render: Cloudflare y el load balancer de
 * Render (https://render.com/articles/how-render-handles-ddos-attacks). Cada
 * uno agrega una IP al final de X-Forwarded-For:
 *
 *   X-Forwarded-For: <lo que mande el cliente>, <IP del cliente>, <IP de Cloudflare>
 *
 * Con "trust proxy" en N saltos, Express toma como req.ip la entrada N contando
 * desde la derecha (la conexión directa cuenta como el primer salto). Con 1
 * quedaba la IP de Cloudflare, compartida por todos los clientes.
 */
export const SALTOS_PROXY_POR_DEFECTO = 2;

/** Un número mayor no tiene sentido en Render y abriría la falsificación. */
export const SALTOS_PROXY_MAXIMO = 5;

export interface SaltosProxy {
  saltos: number;
  /** true si SALTOS_PROXY traía un valor que no se pudo usar. */
  valorInvalido: boolean;
}

/**
 * Lee SALTOS_PROXY: un entero de 0 a SALTOS_PROXY_MAXIMO. Si falta o no es
 * válido, usa SALTOS_PROXY_POR_DEFECTO. Nunca acepta "true": Express tomaría
 * la IP de la izquierda de X-Forwarded-For, que el cliente puede inventar.
 */
export function leerSaltosProxy(valor: string | undefined): SaltosProxy {
  if (valor === undefined || valor.trim() === "") {
    return { saltos: SALTOS_PROXY_POR_DEFECTO, valorInvalido: false };
  }
  const texto = valor.trim();
  const numero = Number(texto);
  if (
    /^\d+$/.test(texto) &&
    Number.isInteger(numero) &&
    numero <= SALTOS_PROXY_MAXIMO
  ) {
    return { saltos: numero, valorInvalido: false };
  }
  return { saltos: SALTOS_PROXY_POR_DEFECTO, valorInvalido: true };
}

/**
 * Configura "trust proxy" en Express con los saltos de SALTOS_PROXY y lo deja
 * en el log del arranque (sin IPs). Lo usan configurar-app.ts y las pruebas.
 */
export function aplicarSaltosProxy(
  app: INestApplication,
  valor: string | undefined = process.env.SALTOS_PROXY,
): number {
  const { saltos, valorInvalido } = leerSaltosProxy(valor);
  app.getHttpAdapter().getInstance().set("trust proxy", saltos);
  const log = new Logger("ProxyConfiable");
  if (valorInvalido) {
    log.warn(
      `SALTOS_PROXY no es un entero entre 0 y ${SALTOS_PROXY_MAXIMO}; se usa ${saltos}`,
    );
  }
  log.log(`trust proxy: ${saltos} saltos (SALTOS_PROXY)`);
  return saltos;
}
