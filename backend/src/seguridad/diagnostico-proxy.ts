import { createHash, randomBytes } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { Request } from "express";
import { FuenteIp, ipCliente, normalizarIp } from "./ip-cliente";

/**
 * Diagnóstico de la IP del cliente detrás de Render, para ajustar
 * SALTOS_PROXY e IP_DESDE_CLOUDFLARE. Apagado por defecto: solo con
 * DIAGNOSTICO_PROXY=true. Nunca escribe una IP: solo cuántas entradas trae
 * X-Forwarded-For, de qué tipo es cada una, qué headers de Cloudflare
 * llegaron, si req.ip coincide con ellos y qué IP usa el límite (como huella).
 */
export function diagnosticoProxyActivo(
  valor: string | undefined = process.env.DIAGNOSTICO_PROXY,
): boolean {
  return valor?.trim().toLowerCase() === "true";
}

export type TipoIp = "publica" | "privada" | "loopback" | "invalida";

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

/** Redes internas: privadas, CGNAT y link-local, IPv4 e IPv6. */
const PRIVADAS = new BlockList();
PRIVADAS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVADAS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVADAS.addSubnet("192.168.0.0", 16, "ipv4");
PRIVADAS.addSubnet("100.64.0.0", 10, "ipv4");
PRIVADAS.addSubnet("169.254.0.0", 16, "ipv4");
PRIVADAS.addSubnet("fc00::", 7, "ipv6");
PRIVADAS.addSubnet("fe80::", 10, "ipv6");

export function tipoIp(valor: string): TipoIp {
  const ip = normalizarIp(valor);
  const version = isIP(ip);
  if (version === 0) {
    return "invalida";
  }
  const familia = version === 4 ? "ipv4" : "ipv6";
  if (LOOPBACK.check(ip, familia)) {
    return "loopback";
  }
  return PRIVADAS.check(ip, familia) ? "privada" : "publica";
}

/** Entradas de X-Forwarded-For, de izquierda a derecha. */
export function entradasXff(header: string | string[] | undefined): string[] {
  const texto = Array.isArray(header) ? header.join(",") : (header ?? "");
  return texto
    .split(",")
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada.length > 0);
}

// Sal aleatoria por arranque, solo en memoria: la huella permite ver si dos
// peticiones tienen la misma IP sin poder recuperarla.
const SAL = randomBytes(16);

/** 8 caracteres de un hash de la IP con la sal del arranque. */
export function huellaIp(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  return createHash("sha256")
    .update(SAL)
    .update(normalizarIp(ip))
    .digest("hex")
    .slice(0, 8);
}

function primerValor(header: string | string[] | undefined): string | null {
  const valor = Array.isArray(header) ? header[0] : header;
  return valor && valor.trim() !== "" ? valor.trim() : null;
}

/** null si el header no llegó; si llegó, si coincide con req.ip. */
function coincide(
  ip: string | undefined,
  header: string | string[] | undefined,
): boolean | null {
  const valor = primerValor(header);
  if (valor === null) {
    return null;
  }
  return ip !== undefined && normalizarIp(valor) === normalizarIp(ip);
}

export interface DiagnosticoProxy {
  evento: "diagnostico_proxy";
  entradas_xff: number;
  /** Valor de "trust proxy" en uso (SALTOS_PROXY). */
  saltos_confiables: number | null;
  tipos_xff: TipoIp[];
  tipo_conexion: TipoIp;
  headers: {
    cf_connecting_ip: boolean;
    true_client_ip: boolean;
    x_real_ip: boolean;
    forwarded: boolean;
  };
  req_ip_igual_cf_connecting_ip: boolean | null;
  req_ip_igual_true_client_ip: boolean | null;
  huella_ip: string | null;
  /** De dónde sale la IP que usa el límite de peticiones (ip-cliente.ts). */
  fuente_ip_limite: FuenteIp;
  /** Huella de la IP que usa el límite. */
  huella_ip_limite: string | null;
}

/** Resumen de la petición sin ninguna IP. */
export function diagnosticarProxy(req: Request): DiagnosticoProxy {
  const xff = entradasXff(req.headers["x-forwarded-for"]);
  const saltos: unknown = req.app?.get("trust proxy");
  const limite = ipCliente(req);
  return {
    evento: "diagnostico_proxy",
    entradas_xff: xff.length,
    saltos_confiables: typeof saltos === "number" ? saltos : null,
    tipos_xff: xff.map(tipoIp),
    tipo_conexion: tipoIp(req.socket?.remoteAddress ?? ""),
    headers: {
      cf_connecting_ip: primerValor(req.headers["cf-connecting-ip"]) !== null,
      true_client_ip: primerValor(req.headers["true-client-ip"]) !== null,
      x_real_ip: primerValor(req.headers["x-real-ip"]) !== null,
      forwarded: primerValor(req.headers["forwarded"]) !== null,
    },
    req_ip_igual_cf_connecting_ip: coincide(
      req.ip,
      req.headers["cf-connecting-ip"],
    ),
    req_ip_igual_true_client_ip: coincide(
      req.ip,
      req.headers["true-client-ip"],
    ),
    huella_ip: huellaIp(req.ip),
    fuente_ip_limite: limite.fuente,
    huella_ip_limite: huellaIp(limite.ip),
  };
}
