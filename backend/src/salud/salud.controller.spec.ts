import { Response } from "express";
import { SaludController } from "./salud.controller";
import { SaludService } from "./salud.service";
import { EstadoSalud, RespuestaSalud } from "./salud.dto";

describe("SaludController", () => {
  it.each([
    ["ok", 200],
    ["degradado", 200],
    ["error", 503],
  ] as const)(
    "con estado %s responde HTTP %i",
    async (estado: EstadoSalud, status) => {
      const salud = { estado } as RespuestaSalud;
      const service = { verificar: jest.fn().mockResolvedValue(salud) };
      const res = { status: jest.fn() } as unknown as Response;

      const respuesta = await new SaludController(
        service as unknown as SaludService,
      ).verificar(res);

      expect(res.status).toHaveBeenCalledWith(status);
      expect(respuesta).toBe(salud);
    },
  );
});
