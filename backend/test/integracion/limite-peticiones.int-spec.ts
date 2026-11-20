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
 * "trust proxy". Cada prueba usa su propia IP en X-Forwarded-For, como haría
 * el proxy de Render, para empezar con el contador en cero.
 */
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
      .set("X-Forwarded-For", ip)
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

    it("usa la IP real del cliente (X-Forwarded-For): otra IP no queda bloqueada", async () => {
      const bloqueada = nuevaIp();
      for (let i = 0; i < 6; i++) {
        await login(bloqueada);
      }

      const otra = await login(nuevaIp());

      expect(otra.status).toBe(401);
    });
  });

  describe("POST /api/users", () => {
    const registro = (ip: string, password = "clave-segura") =>
      request(servidor())
        .post("/api/users")
        .set("X-Forwarded-For", ip)
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
        .set("X-Forwarded-For", ip)
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
        .set("X-Forwarded-For", ip)
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
        .set("X-Forwarded-For", ip)
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
        .set("X-Forwarded-For", ip);
      estados.push(res.status);
    }

    expect(estados).toEqual([200, 200, 200]);
  });
});
