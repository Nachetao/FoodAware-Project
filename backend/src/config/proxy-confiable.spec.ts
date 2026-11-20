import { Controller, Get, INestApplication, Logger, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Request } from "express";
import {
  SALTOS_PROXY_MAXIMO,
  SALTOS_PROXY_POR_DEFECTO,
  aplicarSaltosProxy,
  leerSaltosProxy,
} from "./proxy-confiable";

describe("leerSaltosProxy", () => {
  it("por defecto usa 2 saltos (Cloudflare y el load balancer de Render)", () => {
    expect(SALTOS_PROXY_POR_DEFECTO).toBe(2);
    expect(leerSaltosProxy(undefined)).toEqual({
      saltos: 2,
      valorInvalido: false,
    });
    expect(leerSaltosProxy("  ")).toEqual({ saltos: 2, valorInvalido: false });
  });

  it.each([
    ["0", 0],
    ["1", 1],
    ["3", 3],
    [" 4 ", 4],
    [String(SALTOS_PROXY_MAXIMO), SALTOS_PROXY_MAXIMO],
  ])("acepta %p", (valor, saltos) => {
    expect(leerSaltosProxy(valor)).toEqual({ saltos, valorInvalido: false });
  });

  it.each([
    "true",
    "TRUE",
    "false",
    "-1",
    "2.5",
    "6",
    "10",
    "dos",
    "1e1",
    "0x2",
  ])("rechaza %p y usa el valor por defecto", (valor) => {
    expect(leerSaltosProxy(valor)).toEqual({
      saltos: SALTOS_PROXY_POR_DEFECTO,
      valorInvalido: true,
    });
  });
});

@Controller()
class ControladorIp {
  @Get("ip")
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

describe("aplicarSaltosProxy", () => {
  let app: INestApplication;
  let url: string;

  async function levantar(valor: string | undefined) {
    const modulo = await Test.createTestingModule({
      controllers: [ControladorIp],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    const saltos = aplicarSaltosProxy(app, valor);
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/ip`;
    return saltos;
  }

  async function ipVista(xff?: string): Promise<string> {
    const res = await fetch(url, {
      headers: xff ? { "X-Forwarded-For": xff } : {},
    });
    return ((await res.json()) as { ip: string }).ip;
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  it("con 2 saltos toma la IP del cliente y no la de Cloudflare", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    expect(await levantar(undefined)).toBe(2);

    // Como llega en Render: <cliente>, <Cloudflare>; el load balancer es la
    // conexión directa.
    expect(await ipVista("198.51.100.7, 172.70.1.1")).toBe("198.51.100.7");
  });

  it("un X-Forwarded-For inventado por el cliente no cambia la IP", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    await levantar(undefined);

    expect(await ipVista("1.2.3.4, 198.51.100.7, 172.70.1.1")).toBe(
      "198.51.100.7",
    );
    expect(await ipVista("9.9.9.9, 8.8.8.8, 198.51.100.7, 172.70.1.1")).toBe(
      "198.51.100.7",
    );
  });

  it("con 1 salto quedaba la IP de Cloudflare (el error que se corrige)", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    await levantar("1");

    expect(await ipVista("198.51.100.7, 172.70.1.1")).toBe("172.70.1.1");
  });

  it("sin proxy delante (local) usa la IP de la conexión", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    await levantar(undefined);

    expect(await ipVista()).toMatch(/127\.0\.0\.1$/);
  });

  it("registra los saltos en el arranque y avisa si el valor no es válido", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

    expect(await levantar("true")).toBe(SALTOS_PROXY_POR_DEFECTO);

    expect(log).toHaveBeenCalledWith("trust proxy: 2 saltos (SALTOS_PROXY)");
    expect(warn).toHaveBeenCalledWith(
      `SALTOS_PROXY no es un entero entre 0 y ${SALTOS_PROXY_MAXIMO}; se usa 2`,
    );
  });

  it("usa SALTOS_PROXY del entorno si no se pasa un valor", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    const original = process.env.SALTOS_PROXY;
    process.env.SALTOS_PROXY = "3";
    try {
      const modulo = await Test.createTestingModule({
        controllers: [ControladorIp],
      }).compile();
      app = modulo.createNestApplication({ logger: false });
      expect(aplicarSaltosProxy(app)).toBe(3);
    } finally {
      if (original === undefined) {
        delete process.env.SALTOS_PROXY;
      } else {
        process.env.SALTOS_PROXY = original;
      }
    }
  });
});
