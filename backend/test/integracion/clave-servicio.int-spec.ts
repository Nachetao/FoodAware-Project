import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { FastApiFalso } from "./fastapi-falso";
import {
  ProductosEnMemoria,
  crearApp,
  producto,
  respuestaBusqueda,
} from "./app-de-prueba";

// entorno.ts define CLAVE_SERVICIO=clave-de-integracion.
const CLAVE = "clave-de-integracion";

describe("Integración: X-Clave-Servicio hacia FastAPI", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let productos: ProductosEnMemoria;

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, productos } = await crearApp(fastapi.url));
  });

  afterAll(async () => {
    await app.close();
    await fastapi.apagar();
  });

  beforeEach(() => {
    fastapi.reiniciar();
    productos.productos.clear();
  });

  const servidor = () => app.getHttpServer();

  it("la búsqueda envía X-Clave-Servicio y X-Request-ID", async () => {
    fastapi.responder("/search", () => ({
      status: 200,
      cuerpo: respuestaBusqueda([producto("7801234000018", "Leche")]),
    }));

    const res = await request(servidor())
      .get("/api/products/search?q=leche")
      .set("X-Request-ID", "int-clave");

    expect(res.status).toBe(200);
    expect(fastapi.peticiones[0]).toMatchObject({
      metodo: "GET",
      ruta: "/search",
      requestId: "int-clave",
      claveServicio: CLAVE,
    });
  });

  it("el análisis con IA (POST /analizar) también envía la clave", async () => {
    fastapi.responder("/analizar", () => ({
      status: 200,
      cuerpo: {
        producto: "Galletas",
        veredicto: { alergenos_detectados: [], es_saludable: true },
      },
    }));

    const res = await request(servidor())
      .post("/api/food/analizar")
      .set("X-Request-ID", "int-analizar")
      .send({ nombre: "Galletas", ingredientes: ["avena"] });

    expect(res.status).toBe(201);
    expect(fastapi.peticiones[0]).toMatchObject({
      metodo: "POST",
      ruta: "/analizar",
      requestId: "int-analizar",
      claveServicio: CLAVE,
      cuerpo: { nombre: "Galletas", ingredientes: ["avena"] },
    });
  });

  it("si FastAPI rechaza la clave (403), no la propaga: usa el respaldo", async () => {
    productos.productos.set(
      "7801234000018",
      producto("7801234000018", "Leche semidescremada"),
    );
    fastapi.responder("/search", () => ({
      status: 403,
      cuerpo: {
        error: {
          codigo: "FORBIDDEN",
          mensaje: "Se requiere una clave de servicio válida",
          request_id: "x",
        },
      },
    }));

    const res = await request(servidor()).get("/api/products/search?q=leche");

    expect(res.status).toBe(200);
    expect(res.headers["x-fuente-datos"]).toBe("respaldo");
    expect(res.body.estado_fuente).toBe("cache");
    // Sin reintentos: un 403 no se arregla solo.
    expect(fastapi.intentos("/search")).toBe(1);
  });
});
