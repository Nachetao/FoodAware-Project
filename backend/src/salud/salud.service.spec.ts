import { Test } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AxiosError } from "axios";
import { of, throwError } from "rxjs";
import {
  SaludService,
  TIMEOUT_SALUD_MS,
  commitDesplegado,
} from "./salud.service";

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

describe("commitDesplegado", () => {
  const COMMIT = "55a40763d1e8c0f2b9a7e5d4c3b2a1f0e9d8c7b6";

  it("usa RENDER_GIT_COMMIT, que Render define en cada despliegue", () => {
    expect(commitDesplegado({ RENDER_GIT_COMMIT: COMMIT })).toBe(COMMIT);
  });

  it("sin RENDER_GIT_COMMIT usa GIT_COMMIT", () => {
    expect(commitDesplegado({ GIT_COMMIT: COMMIT })).toBe(COMMIT);
  });

  it("RENDER_GIT_COMMIT tiene prioridad sobre GIT_COMMIT", () => {
    expect(
      commitDesplegado({ RENDER_GIT_COMMIT: COMMIT, GIT_COMMIT: "otro" }),
    ).toBe(COMMIT);
  });

  it.each([
    ["sin ninguna de las dos", {}],
    ["con las dos vacías", { RENDER_GIT_COMMIT: "", GIT_COMMIT: "  " }],
  ])("%s es null", (_caso, env) => {
    expect(commitDesplegado(env)).toBeNull();
  });
});

describe("SaludService: commit en la respuesta", () => {
  const entornoOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...entornoOriginal };
  });

  async function crearServicio(): Promise<SaludService> {
    const module = await Test.createTestingModule({
      providers: [
        SaludService,
        {
          provide: DataSource,
          useValue: { query: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: HttpService,
          useValue: { get: () => respuestaFastApi(200, "ok") },
        },
        { provide: ConfigService, useValue: { get: () => PYTHON_API_URL } },
      ],
    }).compile();
    return module.get(SaludService);
  }

  it("informa el commit desplegado después de version, como FastAPI", async () => {
    process.env.RENDER_GIT_COMMIT = "abc1234";

    const salud = await (await crearServicio()).verificar();

    expect(salud.commit).toBe("abc1234");
    expect(Object.keys(salud).slice(0, 4)).toEqual([
      "estado",
      "servicio",
      "version",
      "commit",
    ]);
  });

  it("sin commit conocido lo informa como null (el campo siempre está)", async () => {
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.GIT_COMMIT;

    const salud = await (await crearServicio()).verificar();

    expect(salud).toHaveProperty("commit", null);
  });
});
