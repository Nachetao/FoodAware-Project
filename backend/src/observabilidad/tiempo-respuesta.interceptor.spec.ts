import { EventEmitter } from "events";
import { CallHandler, ExecutionContext } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { firstValueFrom, of, throwError } from "rxjs";
import { TiempoRespuestaInterceptor } from "./tiempo-respuesta.interceptor";

function crearContexto() {
  const req = { method: "GET", path: "/api/products/search" };
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn(),
  });
  const context = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { res, context };
}

describe("TiempoRespuestaInterceptor", () => {
  let interceptor: TiempoRespuestaInterceptor;
  let info: jest.Mock;

  beforeEach(() => {
    info = jest.fn();
    interceptor = new TiempoRespuestaInterceptor({
      logger: { info },
    } as unknown as PinoLogger);
  });

  it("agrega X-Response-Time-ms con 3 decimales", async () => {
    const { res, context } = crearContexto();
    const next: CallHandler = { handle: () => of({ ok: true }) };

    await firstValueFrom(interceptor.intercept(context, next));

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Response-Time-ms",
      expect.stringMatching(/^\d+\.\d{3}$/),
    );
  });

  it("también lo agrega si el handler falla, y deja pasar el error", async () => {
    const { res, context } = crearContexto();
    const error = new Error("falla");
    const next: CallHandler = { handle: () => throwError(() => error) };

    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBe(error);
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Response-Time-ms",
      expect.any(String),
    );
  });

  it("registra un log de acceso con método, ruta, status y duración al terminar", async () => {
    const { res, context } = crearContexto();
    const next: CallHandler = { handle: () => of(null) };

    await firstValueFrom(interceptor.intercept(context, next));
    expect(info).not.toHaveBeenCalled();
    res.statusCode = 503;
    res.emit("finish");

    expect(info).toHaveBeenCalledWith(
      {
        logger: "AccesoHttp",
        evento: "acceso_http",
        metodo: "GET",
        ruta: "/api/products/search",
        codigo_estado: 503,
        duracion_ms: expect.any(Number),
      },
      expect.stringMatching(/^GET \/api\/products\/search 503 en \d+\.\d ms$/),
    );
  });
});
