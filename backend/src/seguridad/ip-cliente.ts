import { isIP } from "node:net";
import { Request } from "express";

/** Quita espacios y el prefijo de IPv4 mapeada en IPv6 (::ffff:1.2.3.4). */
export function normalizarIp(valor: string): string {
  const ip = valor.trim();
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapeada ? mapeada[1] : ip;
}

/** Header que Cloudflare arma con la IP de la conexión del cliente. */
export const HEADER_CF_CONNECTING_IP = "cf-connecting-ip";

export type FuenteIp = "cf-connecting-ip" | "req.ip";

export interface IpCliente {
  ip: string | undefined;
  fuente: FuenteIp;
}

/**
 * IP_DESDE_CLOUDFLARE: activado por defecto (Render pone Cloudflare delante
 * de todos sus web services). Solo "false" lo apaga, por ejemplo si algún
 * día el backend no está detrás de Cloudflare: ahí cualquiera podría escribir
 * el header. Se lee en cada petición.
 */
export function ipDesdeCloudflareActivo(
  valor: string | undefined = process.env.IP_DESDE_CLOUDFLARE,
): boolean {
  return valor?.trim().toLowerCase() !== "false";
}

/**
 * IP con la que el límite de peticiones identifica al cliente.
 *
 * Primero CF-Connecting-IP: Cloudflare lo arma con la IP de la conexión TCP
 * y recomienda leerlo en vez de X-Forwarded-For
 * (https://developers.cloudflare.com/fundamentals/reference/http-headers/).
 * En Render, X-Forwarded-For no sirve para esto: un cliente que manda el suyo
 * logra que req.ip sea la IP que inventó.
 *
 * Si el header no viene, o no trae exactamente una IP válida (vacío, texto,
 * varias IPs o el header repetido), se usa req.ip (trust proxy con
 * SALTOS_PROXY).
 */
export function ipCliente(req: Request): IpCliente {
  if (ipDesdeCloudflareActivo()) {
    const crudo = req.headers[HEADER_CF_CONNECTING_IP];
    if (typeof crudo === "string") {
      const ip = normalizarIp(crudo);
      if (isIP(ip) !== 0) {
        return { ip, fuente: "cf-connecting-ip" };
      }
    }
  }
  return { ip: req.ip, fuente: "req.ip" };
}
