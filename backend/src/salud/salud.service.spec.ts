import { Test } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AxiosError } from "axios";
import { of, throwError } from "rxjs";
import { SaludService, TIMEOUT_SALUD_MS } from "./salud.service";

const PYTHON_API_URL = "http://python-service:8000";

function respuestaFastApi(status: number, estado?: string) {
  return of({ status, data: estado ? { estado } : {} });
}

describe("SaludService", () => {
  let service: SaludService;
  let dataSource: { query: jest.Mock };
  let httpService: { get: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([{ "?column?": 1 }]) };
    httpService = {
      get: jest.fn().mockReturnValue(respuestaFastApi(200, "ok")),
    };

    const module = await Test.createTestingModule({
      providers: [
        SaludService,
        { provide: DataSource, useValue: dataSource },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: { get: () => PYTHON_API_URL } },
      ],
    }).compile();

    service = module.get(SaludService);
  });

  afterEach(() => jest.useRealTimers());

  it("responde ok con el formato de FastAPI si todo responde", async () => {
    const salud = await service.verificar();

    expect(salud).toMatchObject({
      estado: "ok",
      servicio: "backend",
      dependencias: { postgresql: "ok", fastapi: "ok" },
      detalle: {
        postgresql: { error: null },
        fastapi: { estado: "ok", error: null },
      },
    });
    expect(salud.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(salud.verificado_en).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    expect(dataSource.query).toHaveBeenCalledWith("SELECT 1");
    expect(httpService.get).toHaveBeenCalledWith(
      `${PYTHON_API_URL}/health`,
      expect.objectContaining({ timeout: TIMEOUT_SALUD_MS }),
    );
  });

  it.each([
    [
      "FastAPI informa degradado",
      respuestaFastApi(200, "degradado"),
      "degradado",
    ],
    ["FastAPI informa error (503)", respuestaFastApi(503, "error"), "error"],
    [
      "FastAPI no acepta conexiones",
      throwError(() => new AxiosError("falla", "ECONNREFUSED")),
      "error",
    ],
    [
      "FastAPI no responde a tiempo",
      throwError(() => new AxiosError("falla", "ECONNABORTED")),
      "error",
    ],
  ])("queda degradado si %s", async (_caso, respuesta, estadoFastApi) => {
    httpService.get.mockReturnValue(respuesta);

    const salud = await service.verificar();

    expect(salud.estado).toBe("degradado");
    expect(salud.dependencias).toEqual({
      postgresql: "ok",
      fastapi: estadoFastApi,
    });
  });

  it("queda en error si PostgreSQL falla, aunque FastAPI esté ok", async () => {
    dataSource.query.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const salud = await service.verificar();

    expect(salud.estado).toBe("error");
    expect(salud.dependencias.postgresql).toBe("error");
    expect(salud.detalle.postgresql).toEqual({
      latencia_ms: null,
      error: "connect ECONNREFUSED",
    });
  });

  it("queda en error si PostgreSQL no responde dentro del timeout", async () => {
    jest.useFakeTimers();
    dataSource.query.mockReturnValue(new Promise(() => undefined));

    const resultado = service.verificar();
    await jest.advanceTimersByTimeAsync(TIMEOUT_SALUD_MS);
    const salud = await resultado;

    expect(salud.estado).toBe("error");
    expect(salud.detalle.postgresql.error).toBe(
      `Sin respuesta en ${TIMEOUT_SALUD_MS} ms`,
    );
  });
});
