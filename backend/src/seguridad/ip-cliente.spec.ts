import { Request } from "express";
import { ipCliente, ipDesdeCloudflareActivo, normalizarIp } from "./ip-cliente";

const REQ_IP = "172.70.1.1";

function req(cfConnectingIp?: string): Request {
  return {
    ip: REQ_IP,
    headers:
      cfConnectingIp === undefined
        ? {}
        : { "cf-connecting-ip": cfConnectingIp },
  } as unknown as Request;
}

describe("ipDesdeCloudflareActivo", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["cualquier cosa", true],
    ["false", false],
    [" FALSE ", false],
  ])("con %p devuelve %p", (valor, esperado) => {
    expect(ipDesdeCloudflareActivo(valor)).toBe(esperado);
  });
});

describe("normalizarIp", () => {
  it("quita espacios y el prefijo de IPv4 mapeada en IPv6", () => {
    expect(normalizarIp(" 198.51.100.7 ")).toBe("198.51.100.7");
    expect(normalizarIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizarIp("2800:150::1")).toBe("2800:150::1");
  });
});

describe("ipCliente", () => {
  const original = process.env.IP_DESDE_CLOUDFLARE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.IP_DESDE_CLOUDFLARE;
    } else {
      process.env.IP_DESDE_CLOUDFLARE = original;
    }
  });

  it.each([
    ["198.51.100.7", "198.51.100.7"],
    [" 198.51.100.7 ", "198.51.100.7"],
    ["2800:150:1:2::7", "2800:150:1:2::7"],
    ["::ffff:198.51.100.7", "198.51.100.7"],
  ])("usa CF-Connecting-IP %p", (header, ip) => {
    delete process.env.IP_DESDE_CLOUDFLARE;

    expect(ipCliente(req(header))).toEqual({ ip, fuente: "cf-connecting-ip" });
  });

  it.each([
    ["sin el header", undefined],
    ["vacío", ""],
    ["con texto", "no-es-una-ip"],
    ["con varias IPs", "198.51.100.7, 203.0.113.9"],
    // Node junta un header repetido con ", ".
    ["repetido", "198.51.100.7, 198.51.100.7"],
    ["con puerto", "198.51.100.7:4321"],
  ])("%s usa req.ip", (_caso, header) => {
    delete process.env.IP_DESDE_CLOUDFLARE;

    expect(ipCliente(req(header))).toEqual({ ip: REQ_IP, fuente: "req.ip" });
  });

  it("con IP_DESDE_CLOUDFLARE=false ignora el header", () => {
    process.env.IP_DESDE_CLOUDFLARE = "false";

    expect(ipCliente(req("198.51.100.7"))).toEqual({
      ip: REQ_IP,
      fuente: "req.ip",
    });
  });
});
