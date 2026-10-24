import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { FastApiFalso } from "./fastapi-falso";
import {
  ProductosEnMemoria,
  crearApp,
  errorContrato,
  producto,
} from "./app-de-prueba";

const CODIGO = "7801234000018";
const RUTA_FASTAPI = `/products/${CODIGO}`;

describe("Integración: detalle de producto", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let productos: ProductosEnMemoria;
  const leche = producto(CODIGO, "Leche semidescremada");

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, productos } = await crearApp(fastapi.url));
  });

  afterAll(async () => {
    await app.close();
    await fastapi.apagar();
  });

  beforeEach(async () => {
    await fastapi.encender();
    fastapi.reiniciar();
    productos.productos.clear();
  });

  const obtener = (codigo = CODIGO) =>
    request(app.getHttpServer()).get(`/api/products/${codigo}`);

  it("devuelve el producto de FastAPI, lo guarda y reenvía el X-Request-ID", async () => {
    fastapi.responder(RUTA_FASTAPI, () => ({ status: 200, cuerpo: leche }));

    const res = await obtener().set("X-Request-ID", "int-detalle");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(leche);
    expect(res.headers["x-fuente-datos"]).toBe("fastapi");
    expect(res.headers["x-request-id"]).toBe("int-detalle");
    expect(fastapi.peticiones[0].requestId).toBe("int-detalle");
    expect(productos.productos.get(CODIGO)).toEqual(leche);
  });

  it("responde 422 sin llamar a FastAPI si el código no tiene de 8 a 14 dígitos", async () => {
    const res = await obtener("12AB");

    expect(res.status).toBe(422);
    expect(res.body.error.codigo).toBe("VALIDATION_ERROR");
    expect(fastapi.peticiones).toHaveLength(0);
  });

  it("propaga el 404 de FastAPI sin usar la base, aunque el producto esté guardado", async () => {
    productos.productos.set(CODIGO, leche);
    fastapi.responder(RUTA_FASTAPI, () => ({
      status: 404,
      cuerpo: errorContrato("NOT_FOUND", `Producto ${CODIGO} no encontrado`),
    }));

    const res = await obtener();

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("NOT_FOUND");
    expect(fastapi.intentos(RUTA_FASTAPI)).toBe(1);
  });

  it("ante 503 reintenta y responde el producto guardado con X-Fuente-Datos: respaldo", async () => {
    productos.productos.set(CODIGO, leche);
    fastapi.responder(RUTA_FASTAPI, () => ({
      status: 503,
      cuerpo: errorContrato("SOURCE_UNAVAILABLE", "No disponible"),
    }));

    const res = await obtener();

    expect(fastapi.intentos(RUTA_FASTAPI)).toBe(3);
    expect(res.status).toBe(200);
    expect(res.headers["x-fuente-datos"]).toBe("respaldo");
    expect(res.body).toEqual(leche);
  });

  it("con FastAPI apagado y el producto sin guardar mantiene el 503", async () => {
    await fastapi.apagar();

    const res = await obtener();

    expect(res.status).toBe(503);
    expect(res.body.error.codigo).toBe("SOURCE_UNAVAILABLE");
  });

  it("si FastAPI nunca responde y está guardado, responde desde el respaldo", async () => {
    productos.productos.set(CODIGO, leche);
    fastapi.responder(RUTA_FASTAPI, () => "colgado");

    const res = await obtener();

    expect(res.status).toBe(200);
    expect(res.headers["x-fuente-datos"]).toBe("respaldo");
  });
});
