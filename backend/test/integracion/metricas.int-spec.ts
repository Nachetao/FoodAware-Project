import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { FastApiFalso } from "./fastapi-falso";
import { crearApp, errorContrato } from "./app-de-prueba";

const CALIDAD = {
  porcentaje_validos: 92,
  porcentaje_duplicados: 5,
  cobertura_ingredientes: 87.5,
  antiguedad_promedio_horas: 18.2,
  total_productos: 1240,
};
const EVALUACION = {
  k: 5,
  precision_at_k: 0.51,
  recall_at_k: 0.48,
  consultas_evaluadas: 20,
  tiempo_promedio_ms: 14.3,
};
const INGESTA = {
  run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
  inicio: "2026-10-20T14:00:00Z",
  fin: "2026-10-20T14:02:30Z",
  duracion_ms: 150000,
  recuperados: 100,
  validos: 92,
  invalidos: 8,
  duplicados: 5,
  errores: 1,
  estado: "completado_con_errores",
};

describe("Integración: métricas e ingesta (sin token)", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app } = await crearApp(fastapi.url));
  });

  afterAll(async () => {
    await app.close();
    await fastapi.apagar();
  });

  beforeEach(async () => {
    await fastapi.encender();
    fastapi.reiniciar();
  });

  const get = (ruta: string) => request(app.getHttpServer()).get(ruta);

  it.each([
    ["/api/metricas/calidad", "/metrics/quality", CALIDAD],
    ["/api/metricas/evaluacion", "/metrics/evaluation", EVALUACION],
    ["/api/ingesta/ultima", "/ingest/runs/latest", INGESTA],
  ])(
    "%s devuelve tal cual la respuesta de FastAPI %s",
    async (rutaBackend, rutaFastApi, cuerpo) => {
      fastapi.responder(rutaFastApi, () => ({ status: 200, cuerpo }));

      const res = await get(rutaBackend).set("X-Request-ID", "int-metricas");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(cuerpo);
      expect(res.headers["x-request-id"]).toBe("int-metricas");
      expect(res.headers["x-response-time-ms"]).toBeDefined();
      expect(fastapi.peticiones).toHaveLength(1);
      expect(fastapi.peticiones[0].requestId).toBe("int-metricas");
    },
  );

  it("propaga el 404 NOT_FOUND si todavía no hay ingestas", async () => {
    fastapi.responder("/ingest/runs/latest", () => ({
      status: 404,
      cuerpo: errorContrato("NOT_FOUND", "No hay ejecuciones de ingesta"),
    }));

    const res = await get("/api/ingesta/ultima");

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("NOT_FOUND");
    expect(fastapi.intentos("/ingest/runs/latest")).toBe(1);
  });

  it("ante 503 reintenta y, sin respaldo, responde el error del contrato", async () => {
    fastapi.responder("/metrics/quality", () => ({
      status: 503,
      cuerpo: errorContrato("SOURCE_UNAVAILABLE", "No disponible"),
    }));

    const res = await get("/api/metricas/calidad");

    expect(fastapi.intentos("/metrics/quality")).toBe(3);
    expect(res.status).toBe(503);
    expect(res.body.error.codigo).toBe("SOURCE_UNAVAILABLE");
  });

  it("con FastAPI apagado responde 503 SOURCE_UNAVAILABLE", async () => {
    await fastapi.apagar();

    const res = await get("/api/metricas/evaluacion").set(
      "X-Request-ID",
      "int-apagado",
    );

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        codigo: "SOURCE_UNAVAILABLE",
        mensaje: "El servicio de búsqueda no está disponible",
        request_id: "int-apagado",
      },
    });
  });
});
