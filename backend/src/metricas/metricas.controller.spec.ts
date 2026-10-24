import { Request } from "express";
import { MetricasController } from "./metricas.controller";
import { FastApiClientService } from "../products/fastapi-client.service";

describe("MetricasController", () => {
  const cliente = {
    metricasCalidad: jest.fn().mockResolvedValue({ total_productos: 1 }),
    metricasEvaluacion: jest.fn().mockResolvedValue({ k: 5 }),
    ultimaIngesta: jest.fn().mockResolvedValue({ estado: "completado" }),
  };
  const controller = new MetricasController(
    cliente as unknown as FastApiClientService,
  );
  const req = { headers: { "x-request-id": "prueba-1" } } as unknown as Request;

  it.each([
    ["calidad", "metricasCalidad", { total_productos: 1 }],
    ["evaluacion", "metricasEvaluacion", { k: 5 }],
    ["ultimaIngesta", "ultimaIngesta", { estado: "completado" }],
  ] as const)(
    "%s devuelve la respuesta de FastAPI con el request id de la petición",
    async (ruta, metodo, esperado) => {
      await expect(controller[ruta]({ ...req } as Request)).resolves.toEqual(
        esperado,
      );
      expect(cliente[metodo]).toHaveBeenCalledWith("prueba-1");
    },
  );
});
