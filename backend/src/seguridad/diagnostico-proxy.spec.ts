import { Request } from "express";
import {
  diagnosticarProxy,
  diagnosticoProxyActivo,
  entradasXff,
  huellaIp,
  tipoIp,
} from "./diagnostico-proxy";

const CLIENTE = "198.51.100.7";
const CLOUDFLARE = "172.70.1.1";
const BALANCEADOR = "10.214.3.9";

function req(
  headers: Record<string, string>,
  ip: string | undefined = CLIENTE,
  saltos: unknown = 2,
): Request {
  return {
    headers,
    ip,
    socket: { remoteAddress: `::ffff:${BALANCEADOR}` },
    app: { get: () => saltos },
  } as unknown as Request;
}

describe("diagnosticoProxyActivo", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["1", false],
    ["true", true],
    [" TRUE ", true],
  ])("con %p devuelve %p", (valor, esperado) => {
    expect(diagnosticoProxyActivo(valor)).toBe(esperado);
  });

  it("está apagado por defecto", () => {
    const original = process.env.DIAGNOSTICO_PROXY;
    delete process.env.DIAGNOSTICO_PROXY;
    try {
      expect(diagnosticoProxyActivo()).toBe(false);
    } finally {
      if (original !== undefined) {
        process.env.DIAGNOSTICO_PROXY = original;
      }
    }
  });
});

describe("tipoIp", () => {
  it.each([
    ["198.51.100.7", "publica"],
    ["2800:150::1", "publica"],
    ["10.0.0.1", "privada"],
    ["172.16.5.4", "privada"],
    ["192.168.1.10", "privada"],
    ["100.64.0.1", "privada"],
    ["169.254.1.1", "privada"],
    ["fd12:3456::1", "privada"],
    ["fe80::1", "privada"],
    ["::ffff:10.1.2.3", "privada"],
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["no-es-ip", "invalida"],
    ["", "invalida"],
    ["1.2.3.4:5678", "invalida"],
  ])("%p es %p", (ip, tipo) => {
    expect(tipoIp(ip)).toBe(tipo);
  });
});

describe("entradasXff", () => {
  it("separa por comas y quita espacios y entradas vacías", () => {
    expect(entradasXff(" 1.1.1.1 ,2.2.2.2,, 3.3.3.3 ")).toEqual([
      "1.1.1.1",
      "2.2.2.2",
      "3.3.3.3",
    ]);
    expect(entradasXff(["1.1.1.1", "2.2.2.2"])).toEqual(["1.1.1.1", "2.2.2.2"]);
    expect(entradasXff(undefined)).toEqual([]);
  });
});

describe("huellaIp", () => {
  it("es estable dentro del arranque, distinta entre IPs y no contiene la IP", () => {
    const huella = huellaIp(CLIENTE);

    expect(huella).toMatch(/^[0-9a-f]{8}$/);
    expect(huellaIp(CLIENTE)).toBe(huella);
    expect(huellaIp(`::ffff:${CLIENTE}`)).toBe(huella);
    expect(huellaIp("198.51.100.8")).not.toBe(huella);
    expect(huellaIp(undefined)).toBeNull();
  });
});

describe("diagnosticarProxy", () => {
  it("resume la cadena de Render sin escribir ninguna IP", () => {
    const resultado = diagnosticarProxy(
      req({
        "x-forwarded-for": `${CLIENTE}, ${CLOUDFLARE}`,
        "cf-connecting-ip": CLIENTE,
        "true-client-ip": CLIENTE,
      }),
    );

    expect(resultado).toEqual({
      evento: "diagnostico_proxy",
      entradas_xff: 2,
      saltos_confiables: 2,
      tipos_xff: ["publica", "publica"],
      tipo_conexion: "privada",
      headers: {
        cf_connecting_ip: true,
        true_client_ip: true,
        x_real_ip: false,
        forwarded: false,
      },
      req_ip_igual_cf_connecting_ip: true,
      req_ip_igual_true_client_ip: true,
      huella_ip: huellaIp(CLIENTE),
      fuente_ip_limite: "cf-connecting-ip",
      huella_ip_limite: huellaIp(CLIENTE),
    });
    const texto = JSON.stringify(resultado);
    for (const ip of [CLIENTE, CLOUDFLARE, BALANCEADOR]) {
      expect(texto).not.toContain(ip);
    }
  });

  it("cuenta las entradas que agrega un cliente y detecta que req.ip no coincide con Cloudflare", () => {
    const resultado = diagnosticarProxy(
      req(
        {
          "x-forwarded-for": `203.0.113.7, ${CLIENTE}, ${CLOUDFLARE}`,
          "cf-connecting-ip": CLIENTE,
        },
        CLOUDFLARE,
        1,
      ),
    );

    expect(resultado.entradas_xff).toBe(3);
    expect(resultado.saltos_confiables).toBe(1);
    expect(resultado.req_ip_igual_cf_connecting_ip).toBe(false);
    expect(resultado.req_ip_igual_true_client_ip).toBeNull();
    // El límite usa la IP de Cloudflare aunque req.ip sea otra.
    expect(resultado.fuente_ip_limite).toBe("cf-connecting-ip");
    expect(resultado.huella_ip).toBe(huellaIp(CLOUDFLARE));
    expect(resultado.huella_ip_limite).toBe(huellaIp(CLIENTE));
    expect(JSON.stringify(resultado)).not.toContain("203.0.113.7");
  });

  it("sin headers de proxy deja las comparaciones en null", () => {
    const resultado = diagnosticarProxy(req({}, "127.0.0.1", "loopback"));

    expect(resultado.entradas_xff).toBe(0);
    expect(resultado.tipos_xff).toEqual([]);
    expect(resultado.saltos_confiables).toBeNull();
    expect(resultado.headers).toEqual({
      cf_connecting_ip: false,
      true_client_ip: false,
      x_real_ip: false,
      forwarded: false,
    });
    expect(resultado.req_ip_igual_cf_connecting_ip).toBeNull();
    expect(resultado.fuente_ip_limite).toBe("req.ip");
    expect(resultado.huella_ip_limite).toBe(huellaIp("127.0.0.1"));
  });
});
