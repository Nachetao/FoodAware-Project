import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { FastApiFalso } from "./fastapi-falso";
import {
  UsuariosEnMemoria,
  crearApp,
  producto,
  respuestaBusqueda,
} from "./app-de-prueba";

const CODIGO = "7801234000018";
const MENSAJE = "Demasiados intentos, espera un minuto.";

/**
 * Límite de peticiones por IP (riesgo P1 de docs/modelo-amenazas.md) con la
 * app real: mismo AppModule y misma configuración que main.ts, incluido
 * "trust proxy" (SALTOS_PROXY, 2 por defecto). Cada prueba usa su propia IP
 * de cliente para empezar con el contador en cero, y X-Forwarded-For llega
 * como en Render: "<cliente>, <Cloudflare>", con la misma IP de Cloudflare
 * para todos.
 */
const CLOUDFLARE = "172.70.1.1";

/** X-Forwarded-For como lo arman Cloudflare y el load balancer de Render. */
const xff = (ip: string, inventada?: string) =>
  [inventada, ip, CLOUDFLARE].filter(Boolean).join(", ");

describe("Integración: límite de peticiones", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let usuarios: UsuariosEnMemoria;
  let ipSiguiente = 1;
  const entornoOriginal = { ...process.env };

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, usuarios } = await crearApp(fastapi.url));
  });

  afterAll(async () => {
    await app.close();
    await fastapi.apagar();
  });

  beforeEach(() => {
    fastapi.reiniciar();
    usuarios.usuarios.clear();
  });

  afterEach(() => {
    process.env = { ...entornoOriginal };
  });

  const servidor = () => app.getHttpServer();

  function nuevaIp(): string {
    return `198.51.100.${ipSiguiente++}`;
  }

  const login = (ip: string) =>
    request(servidor())
      .post("/api/auth/login")
      .set("X-Forwarded-For", xff(ip))
      .send({ correo: "nadie@correo.cl", password: "no-es-la-clave" });

  describe("POST /api/auth/login", () => {
    it("5 intentos fallidos responden 401 y el sexto en el mismo minuto responde 429", async () => {
      const ip = nuevaIp();

      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        estados.push((await login(ip)).status);
      }
      const sexto = await login(ip);

      expect(estados).toEqual([401, 401, 401, 401, 401]);
      expect(sexto.status).toBe(429);
      // Mismo formato que el 401 del login y el 409 del registro.
      expect(sexto.body).toEqual({
        statusCode: 429,
        message: MENSAJE,
        error: "Too Many Requests",
      });
      expect(Number(sexto.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("usa la IP real del cliente: otro cliente detrás de la misma IP de Cloudflare no queda bloqueado", async () => {
      const bloqueada = nuevaIp();
      for (let i = 0; i < 6; i++) {
        await login(bloqueada);
      }

      const otra = await login(nuevaIp());

      expect(otra.status).toBe(401);
    });

    it("cambiar la IP inventada a la izquierda de X-Forwarded-For no evita el 429", async () => {
      const atacante = nuevaIp();

      const estados: number[] = [];
      for (let i = 1; i <= 6; i++) {
        const res = await request(servidor())
          .post("/api/auth/login")
          .set("X-Forwarded-For", xff(atacante, `192.0.2.${i}`))
          .send({ correo: "nadie@correo.cl", password: "no-es-la-clave" });
        estados.push(res.status);
      }

      expect(estados).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it("con SALTOS_PROXY=1 todos comparten la IP de Cloudflare (el error que se corrigió)", async () => {
      process.env.SALTOS_PROXY = "1";
      const otraApp = (await crearApp(fastapi.url)).app;
      try {
        const intentar = (ip: string) =>
          request(otraApp.getHttpServer())
            .post("/api/auth/login")
            .set("X-Forwarded-For", xff(ip))
            .send({ correo: "nadie@correo.cl", password: "no-es-la-clave" });
        for (let i = 0; i < 5; i++) {
          await intentar(nuevaIp());
        }

        const otroCliente = await intentar(nuevaIp());

        expect(otroCliente.status).toBe(429);
      } finally {
        await otraApp.close();
      }
    });
  });

  describe("POST /api/auth/login con CF-Connecting-IP (Cloudflare)", () => {
    const loginCloudflare = (cfConnectingIp: string, xffCompleto: string) =>
      request(servidor())
        .post("/api/auth/login")
        .set("CF-Connecting-IP", cfConnectingIp)
        .set("X-Forwarded-For", xffCompleto)
        .send({ correo: "nadie@correo.cl", password: "no-es-la-clave" });

    it("el curl con X-Forwarded-For falsificado recibe 429 en el sexto intento si CF-Connecting-IP es el mismo", async () => {
      const cliente = nuevaIp();

      const estados: number[] = [];
      for (let i = 1; i <= 6; i++) {
        // Como llegó en staging: la IP inventada queda donde se lee req.ip.
        const res = await loginCloudflare(
          cliente,
          `192.0.2.${i}, ${CLOUDFLARE}`,
        );
        estados.push(res.status);
      }

      expect(estados).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it("dos clientes con distinto CF-Connecting-IP no comparten contador", async () => {
      const xffComun = `192.0.2.250, ${CLOUDFLARE}`;
      const computador = nuevaIp();
      for (let i = 0; i < 6; i++) {
        await loginCloudflare(computador, xffComun);
      }

      const celular = await loginCloudflare(nuevaIp(), xffComun);

      expect(celular.status).toBe(401);
    });

    it("sin el header usa req.ip (X-Forwarded-For con SALTOS_PROXY)", async () => {
      const ip = nuevaIp();

      const estados: number[] = [];
      for (let i = 0; i < 6; i++) {
        estados.push((await login(ip)).status);
      }

      expect(estados.at(-1)).toBe(429);
    });

    it("con un valor que no es una IP usa req.ip", async () => {
      const ip = nuevaIp();

      const estados: number[] = [];
      for (let i = 1; i <= 6; i++) {
        estados.push((await loginCloudflare(`no-es-ip-${i}`, xff(ip))).status);
      }

      expect(estados.at(-1)).toBe(429);
    });

    it("con IP_DESDE_CLOUDFLARE=false ignora el header", async () => {
      process.env.IP_DESDE_CLOUDFLARE = "false";
      const cfComun = nuevaIp();

      const estados: number[] = [];
      for (let i = 0; i < 6; i++) {
        estados.push((await loginCloudflare(cfComun, xff(nuevaIp()))).status);
      }

      expect(estados).not.toContain(429);
    });
  });

  describe("POST /api/users", () => {
    const registro = (ip: string, password = "clave-segura") =>
      request(servidor())
        .post("/api/users")
        .set("X-Forwarded-For", xff(ip))
        .send({
          nombre: "Ana",
          correo: `ana${ipSiguiente}@correo.cl`,
          password,
        });

    it("rechaza con 400 una contraseña de menos de 8 caracteres", async () => {
      const res = await registro(nuevaIp(), "1234567");

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(
        "La contraseña debe tener al menos 8 caracteres",
      );
      expect(usuarios.usuarios.size).toBe(0);
    });

    it("con 8 caracteres crea la cuenta y el login no exige largo mínimo", async () => {
      const ip = nuevaIp();
      const res = await registro(ip, "12345678");
      // Una cuenta anterior a la regla, con contraseña corta, sigue
      // recibiendo 401 (credenciales) y no 400 (validación).
      const corta = await request(servidor())
        .post("/api/auth/login")
        .set("X-Forwarded-For", xff(ip))
        .send({ correo: "antigua@correo.cl", password: "x1" });

      expect(res.status).toBe(201);
      expect(corta.status).toBe(401);
    });

    it("responde 429 al superar LIMITE_PUBLICO_POR_MINUTO", async () => {
      process.env.LIMITE_PUBLICO_POR_MINUTO = "2";
      const ip = nuevaIp();

      const estados = [
        (await registro(ip)).status,
        (await registro(ip, "otra-clave")).status,
        (await registro(ip)).status,
      ];

      expect(estados.slice(0, 2)).not.toContain(429);
      expect(estados[2]).toBe(429);
    });
  });

  it("POST /api/food/analizar responde 429 al superar el límite", async () => {
    process.env.LIMITE_PUBLICO_POR_MINUTO = "1";
    fastapi.responder("/analizar", () => ({
      status: 200,
      cuerpo: {
        producto: "Galletas",
        veredicto: { alergenos_detectados: [], es_saludable: true },
      },
    }));
    const ip = nuevaIp();
    const analizar = () =>
      request(servidor())
        .post("/api/food/analizar")
        .set("X-Forwarded-For", xff(ip))
        .send({ nombre: "Galletas", ingredientes: ["avena"] });

    const primero = await analizar();
    const segundo = await analizar();

    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(429);
    expect(segundo.body.message).toBe(MENSAJE);
    expect(fastapi.intentos("/analizar")).toBe(1);
  });

  it("GET /api/products/:codigo_barras responde 429 con el formato del contrato", async () => {
    process.env.LIMITE_PUBLICO_POR_MINUTO = "1";
    fastapi.responder(`/products/${CODIGO}`, () => ({
      status: 200,
      cuerpo: producto(CODIGO, "Leche semidescremada"),
    }));
    const ip = nuevaIp();
    const obtener = () =>
      request(servidor())
        .get(`/api/products/${CODIGO}`)
        .set("X-Forwarded-For", xff(ip))
        .set("X-Request-ID", "int-limite");

    const primero = await obtener();
    const segundo = await obtener();

    expect(primero.status).toBe(200);
    expect(segundo.status).toBe(429);
    expect(segundo.body).toEqual({
      error: {
        codigo: "TOO_MANY_REQUESTS",
        mensaje: MENSAJE,
        request_id: "int-limite",
      },
    });
    expect(segundo.headers["x-request-id"]).toBe("int-limite");
  });

  it("la búsqueda no tiene límite", async () => {
    process.env.LIMITE_PUBLICO_POR_MINUTO = "1";
    fastapi.responder("/search", () => ({
      status: 200,
      cuerpo: respuestaBusqueda([]),
    }));
    const ip = nuevaIp();

    const estados: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(servidor())
        .get("/api/products/search?q=leche")
        .set("X-Forwarded-For", xff(ip));
      estados.push(res.status);
    }

    expect(estados).toEqual([200, 200, 200]);
  });
});
