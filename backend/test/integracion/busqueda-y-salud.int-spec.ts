import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { FastApiFalso } from "./fastapi-falso";
import {
  BaseDeDatosFalsa,
  ProductosEnMemoria,
  crearApp,
  errorContrato,
  producto,
  respuestaBusqueda,
} from "./app-de-prueba";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("Integración NestJS ↔ FastAPI simulado", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let productos: ProductosEnMemoria;
  let base: BaseDeDatosFalsa;

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, productos, base } = await crearApp(fastapi.url));
  });

  afterAll(async () => {
    await app.close();
    await fastapi.apagar();
  });

  beforeEach(async () => {
    await fastapi.encender();
    fastapi.reiniciar();
    productos.productos.clear();
    base.caida = false;
  });

  const buscar = (query = "q=leche") =>
    request(app.getHttpServer()).get(`/api/products/search?${query}`);

  describe("búsqueda con FastAPI disponible", () => {
    const leche = producto("7801234000018", "Leche semidescremada");

    beforeEach(() => {
      fastapi.responder("/search", () => ({
        status: 200,
        cuerpo: respuestaBusqueda([leche]),
      }));
    });

    it("responde 200 con la forma del contrato, X-Fuente-Datos: fastapi y guarda los productos", async () => {
      const res = await buscar("q=leche&limit=5&offset=10");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(respuestaBusqueda([leche]));
      expect(res.headers["x-fuente-datos"]).toBe("fastapi");
      expect(productos.productos.get("7801234000018")).toEqual(leche);

      const [peticion] = fastapi.peticiones;
      expect(peticion.ruta).toBe("/search");
      expect(Object.fromEntries(peticion.query)).toEqual({
        q: "leche",
        limit: "5",
        offset: "10",
      });
    });

    it("reenvía el X-Request-ID recibido a FastAPI y lo devuelve", async () => {
      const res = await buscar().set("X-Request-ID", "int-123");

      expect(fastapi.peticiones[0].requestId).toBe("int-123");
      expect(res.headers["x-request-id"]).toBe("int-123");
    });

    it("sin X-Request-ID genera un uuid y envía el mismo a FastAPI", async () => {
      const res = await buscar();

      expect(res.headers["x-request-id"]).toMatch(UUID);
      expect(fastapi.peticiones[0].requestId).toBe(res.headers["x-request-id"]);
    });

    it("agrega X-Response-Time-ms", async () => {
      const res = await buscar();

      expect(res.headers["x-response-time-ms"]).toMatch(/^\d+\.\d{3}$/);
    });
  });

  describe("errores que no usan respaldo", () => {
    it("responde 422 VALIDATION_ERROR sin llamar a FastAPI", async () => {
      const res = await buscar("q=a");

      expect(res.status).toBe(422);
      expect(res.body.error.codigo).toBe("VALIDATION_ERROR");
      expect(res.body.error.request_id).toBe(res.headers["x-request-id"]);
      expect(res.headers["x-response-time-ms"]).toBeDefined();
      expect(fastapi.intentos("/search")).toBe(0);
    });

    it("propaga un 422 de FastAPI sin reintentar ni usar el respaldo", async () => {
      productos.productos.set("1", producto("7801234000018", "Leche"));
      fastapi.responder("/search", () => ({
        status: 422,
        cuerpo: errorContrato("VALIDATION_ERROR", "Solicitud inválida"),
      }));

      const res = await buscar();

      expect(res.status).toBe(422);
      expect(res.body.error.codigo).toBe("VALIDATION_ERROR");
      expect(fastapi.intentos("/search")).toBe(1);
    });
  });

  describe("FastAPI con fallas: reintentos y respaldo", () => {
    const guardada = producto("7809999000017", "Leche entera guardada");

    it("ante 503 reintenta 2 veces y responde desde el respaldo", async () => {
      productos.productos.set(guardada.codigo_barras, guardada);
      fastapi.responder("/search", () => ({
        status: 503,
        cuerpo: errorContrato("SOURCE_UNAVAILABLE", "No disponible"),
      }));

      const res = await buscar();

      expect(fastapi.intentos("/search")).toBe(3);
      expect(res.status).toBe(200);
      expect(res.headers["x-fuente-datos"]).toBe("respaldo");
      expect(res.body.estado_fuente).toBe("cache");
      expect(res.body.resultados.map((r) => r.producto.nombre)).toEqual([
        "Leche entera guardada",
      ]);
    });

    it("con FastAPI apagado y respaldo vacío responde 503 SOURCE_UNAVAILABLE", async () => {
      await fastapi.apagar();

      const res = await buscar().set("X-Request-ID", "int-apagado");

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: {
          codigo: "SOURCE_UNAVAILABLE",
          mensaje: "El servicio de búsqueda no está disponible",
          request_id: "int-apagado",
        },
      });
    });

    it("si FastAPI nunca responde y el respaldo está vacío, responde 504 SOURCE_TIMEOUT", async () => {
      fastapi.responder("/search", () => "colgado");

      const res = await buscar();

      expect(fastapi.intentos("/search")).toBe(3);
      expect(res.status).toBe(504);
      expect(res.body.error.codigo).toBe("SOURCE_TIMEOUT");
    });

    it("si FastAPI nunca responde y hay datos guardados, responde desde el respaldo", async () => {
      productos.productos.set(guardada.codigo_barras, guardada);
      fastapi.responder("/search", () => "colgado");

      const res = await buscar();

      expect(res.status).toBe(200);
      expect(res.headers["x-fuente-datos"]).toBe("respaldo");
    });
  });

  describe("GET /api/health", () => {
    const salud = () => request(app.getHttpServer()).get("/api/health");

    it("responde ok con PostgreSQL y FastAPI disponibles", async () => {
      const res = await salud();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        estado: "ok",
        servicio: "backend",
        dependencias: { postgresql: "ok", fastapi: "ok" },
      });
      expect(res.headers["x-response-time-ms"]).toBeDefined();
    });

    it("responde degradado (HTTP 200) con FastAPI apagado", async () => {
      await fastapi.apagar();

      const res = await salud();

      expect(res.status).toBe(200);
      expect(res.body.estado).toBe("degradado");
      expect(res.body.dependencias).toEqual({
        postgresql: "ok",
        fastapi: "error",
      });
    });

    it("responde error (HTTP 503) con la base caída", async () => {
      base.caida = true;

      const res = await salud();

      expect(res.status).toBe(503);
      expect(res.body.estado).toBe("error");
      expect(res.body.dependencias.postgresql).toBe("error");
    });
  });
});
