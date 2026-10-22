import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { defer, of, throwError } from "rxjs";
import { FastApiClientService } from "./fastapi-client.service";
import { ContratoHttpException } from "./contrato-http.exception";
import { RespuestaBusqueda } from "./contrato/busqueda";
import { AllergenCode, CodigoError, DietLabel } from "./contrato/enums";
import { ErrorContrato } from "./contrato/error";

const PYTHON_API_URL = "http://python-service:8000";
const REQUEST_ID = "prueba-123";
const PARAMETROS = { q: "leche", limit: 10, offset: 0 };

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

const respuestaBusqueda: RespuestaBusqueda = {
  consulta: "leche",
  total: 1,
  tiempo_ms: 0.42,
  estado_fuente: "online",
  resultados: [
    {
      score: 1,
      posicion: 1,
      producto: {
        codigo_barras: "7801234000018",
        nombre: "Leche semidescremada",
        marca: "Lácteos del Sur",
        cantidad: "1 L",
        ingredientes_texto: "Leche semidescremada, vitamina A, vitamina D3.",
        ingredientes: ["leche semidescremada", "vitamina a", "vitamina d3"],
        alergenos: [AllergenCode.LACTEOS],
        trazas: [],
        etiquetas_dieta: [DietLabel.VEGETARIANO, DietLabel.SIN_GLUTEN],
        nutriscore: "b",
        imagen_url: null,
        procedencia: {
          fuente: "openfoodfacts",
          url_fuente: "https://world.openfoodfacts.org/product/7801234000018",
          recuperado_en: "2026-10-20T14:30:00Z",
          modificado_en_fuente: null,
          run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
          hash_contenido: "a".repeat(64),
        },
        calidad: { es_valido: true, problemas: [], completitud: 1 },
      },
    },
  ],
};

function respuestaHttp<T>(status: number, data: T): AxiosResponse<T> {
  return { status, statusText: "", data, headers: {}, config };
}

function errorAxios(
  code: string,
  response?: AxiosResponse<unknown>,
): AxiosError {
  return new AxiosError("falla simulada", code, config, {}, response);
}

function errorContrato(codigo: CodigoError, mensaje: string): ErrorContrato {
  return { error: { codigo, mensaje, request_id: REQUEST_ID } };
}

function errorHttpContrato(status: number, codigo: CodigoError): AxiosError {
  return errorAxios(
    "ERR_BAD_RESPONSE",
    respuestaHttp(status, errorContrato(codigo, "Error de FastAPI")),
  );
}

describe("FastApiClientService", () => {
  let service: FastApiClientService;
  let httpService: { get: jest.Mock };
  let logWarn: jest.SpyInstance;
  let intentos: number;

  async function crearServicio(variables: Record<string, string> = {}) {
    const entorno: Record<string, string> = { PYTHON_API_URL, ...variables };
    const module = await Test.createTestingModule({
      providers: [
        FastApiClientService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: {
            get: (clave: string, porDefecto?: unknown) =>
              entorno[clave] ?? porDefecto,
          },
        },
      ],
    }).compile();
    service = module.get(FastApiClientService);
  }

  beforeEach(async () => {
    httpService = { get: jest.fn() };
    // Los errores simulados generan logs esperados; se silencian en la salida.
    logWarn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    await crearServicio();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * Cada suscripción (intento) recibe el siguiente paso; el último se repite.
   * Así se simula que retry vuelve a ejecutar la petición HTTP.
   */
  function responderEnOrden(...pasos: Array<AxiosResponse | Error>) {
    intentos = 0;
    httpService.get.mockReturnValue(
      defer(() => {
        const paso = pasos[Math.min(intentos, pasos.length - 1)];
        intentos++;
        return paso instanceof Error ? throwError(() => paso) : of(paso);
      }),
    );
  }

  async function buscarConEsperas(): Promise<RespuestaBusqueda> {
    const resultado = service.buscar(PARAMETROS, REQUEST_ID);
    await jest.runAllTimersAsync();
    return resultado;
  }

  async function capturarError(): Promise<ContratoHttpException> {
    const resultado = service.buscar(PARAMETROS, REQUEST_ID).then(
      () => {
        throw new Error("Se esperaba que buscar() fallara");
      },
      (error: ContratoHttpException) => error,
    );
    await jest.runAllTimersAsync();
    return resultado;
  }

  describe("buscar", () => {
    it("llama a GET /search con los parámetros y el X-Request-ID", async () => {
      responderEnOrden(respuestaHttp(200, respuestaBusqueda));

      await service.buscar({ q: "pan", limit: 5, offset: 10 }, REQUEST_ID);

      expect(httpService.get).toHaveBeenCalledWith(`${PYTHON_API_URL}/search`, {
        params: { q: "pan", limit: 5, offset: 10 },
        headers: { "X-Request-ID": REQUEST_ID },
      });
    });

    it("devuelve el cuerpo de FastAPI sin modificarlo", async () => {
      responderEnOrden(respuestaHttp(200, respuestaBusqueda));

      const resultado = await service.buscar(PARAMETROS, REQUEST_ID);

      expect(resultado).toEqual(respuestaBusqueda);
      expect(intentos).toBe(1);
    });

    it.each([
      [422, CodigoError.VALIDATION_ERROR],
      [500, CodigoError.INTERNAL_ERROR],
      [503, CodigoError.SOURCE_UNAVAILABLE],
      [504, CodigoError.SOURCE_TIMEOUT],
    ])(
      "propaga un %i del contrato con el mismo status y cuerpo",
      async (status, codigo) => {
        responderEnOrden(errorHttpContrato(status, codigo));

        const error = await capturarError();

        expect(error).toBeInstanceOf(ContratoHttpException);
        expect(error.getStatus()).toBe(status);
        expect(error.getResponse()).toEqual(
          errorContrato(codigo, "Error de FastAPI"),
        );
      },
    );

    it.each(["ECONNABORTED", "ETIMEDOUT"])(
      "responde 504 SOURCE_TIMEOUT si axios falla con %s",
      async (code) => {
        responderEnOrden(errorAxios(code));

        const error = await capturarError();

        expect(error.getStatus()).toBe(504);
        expect(error.getResponse()).toEqual(
          errorContrato(
            CodigoError.SOURCE_TIMEOUT,
            "El servicio de búsqueda no respondió a tiempo",
          ),
        );
      },
    );

    it("responde 503 SOURCE_UNAVAILABLE si FastAPI no acepta conexiones", async () => {
      responderEnOrden(errorAxios("ECONNREFUSED"));

      const error = await capturarError();

      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toEqual(
        errorContrato(
          CodigoError.SOURCE_UNAVAILABLE,
          "El servicio de búsqueda no está disponible",
        ),
      );
    });

    it.each([
      ["el error nativo de FastAPI", 404, { detail: "Not Found" }],
      [
        "un código fuera del contrato",
        404,
        { error: { codigo: "OTRO", mensaje: "x", request_id: REQUEST_ID } },
      ],
      ["un cuerpo de texto", 502, "<html>Bad Gateway</html>"],
    ])("responde 502 INTERNAL_ERROR ante %s", async (_caso, status, cuerpo) => {
      responderEnOrden(
        errorAxios("ERR_BAD_RESPONSE", respuestaHttp(status, cuerpo)),
      );

      const error = await capturarError();

      expect(error.getStatus()).toBe(502);
      expect(error.getResponse()).toEqual(
        errorContrato(
          CodigoError.INTERNAL_ERROR,
          "Respuesta inesperada del servicio de búsqueda",
        ),
      );
    });

    it("responde 500 INTERNAL_ERROR ante un error que no es de axios", async () => {
      responderEnOrden(new Error("boom"));

      const error = await capturarError();

      expect(error.getStatus()).toBe(500);
      expect(error.getResponse()).toEqual(
        errorContrato(
          CodigoError.INTERNAL_ERROR,
          "Error interno al consultar el servicio de búsqueda",
        ),
      );
      expect(intentos).toBe(1);
    });
  });

  describe("reintentos", () => {
    it.each([
      ["sin conexión", errorAxios("ECONNREFUSED")],
      ["timeout", errorAxios("ECONNABORTED")],
      [
        "un 502 fuera del contrato",
        errorAxios("ERR_BAD_RESPONSE", respuestaHttp(502, "<html>")),
      ],
      ["un 503", errorHttpContrato(503, CodigoError.SOURCE_UNAVAILABLE)],
      ["un 504", errorHttpContrato(504, CodigoError.SOURCE_TIMEOUT)],
    ])(
      "reintenta tras %s y responde si FastAPI se recupera",
      async (_caso, error) => {
        responderEnOrden(error, respuestaHttp(200, respuestaBusqueda));

        const resultado = await buscarConEsperas();

        expect(resultado).toEqual(respuestaBusqueda);
        expect(intentos).toBe(2);
      },
    );

    it("hace 3 intentos en total y devuelve el último error si FastAPI no se recupera", async () => {
      responderEnOrden(errorAxios("ECONNREFUSED"));

      const error = await capturarError();

      expect(intentos).toBe(3);
      expect(error.getStatus()).toBe(503);
    });

    it.each([
      [422, CodigoError.VALIDATION_ERROR],
      [404, CodigoError.NOT_FOUND],
      [500, CodigoError.INTERNAL_ERROR],
    ])("no reintenta un %i", async (status, codigo) => {
      responderEnOrden(errorHttpContrato(status, codigo));

      const error = await capturarError();

      expect(intentos).toBe(1);
      expect(error.getStatus()).toBe(status);
      expect(logWarn).not.toHaveBeenCalledWith(
        expect.stringContaining("Reintento"),
      );
    });

    it.each([
      ["sin jitter", 0, [250, 500]],
      ["con el jitter máximo", 0.9999, [350, 600]],
    ])(
      "espera 250 ms y luego 500 ms entre intentos, %s",
      async (_caso, aleatorio, esperas) => {
        jest.spyOn(Math, "random").mockReturnValue(aleatorio);
        responderEnOrden(errorAxios("ECONNREFUSED"));

        await capturarError();

        expect(logWarn).toHaveBeenCalledWith(
          expect.stringContaining(
            `Reintento 1/2 de GET /search tras ECONNREFUSED; espera ${esperas[0]} ms`,
          ),
        );
        expect(logWarn).toHaveBeenCalledWith(
          expect.stringContaining(
            `Reintento 2/2 de GET /search tras ECONNREFUSED; espera ${esperas[1]} ms`,
          ),
        );
      },
    );

    it("registra cada reintento con el request id, el motivo y la espera", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0.5);
      responderEnOrden(
        errorAxios("ECONNREFUSED"),
        errorHttpContrato(503, CodigoError.SOURCE_UNAVAILABLE),
        respuestaHttp(200, respuestaBusqueda),
      );

      await buscarConEsperas();

      expect(logWarn).toHaveBeenCalledWith(
        "[prueba-123] Reintento 1/2 de GET /search tras ECONNREFUSED; espera 300 ms",
      );
      expect(logWarn).toHaveBeenCalledWith(
        "[prueba-123] Reintento 2/2 de GET /search tras HTTP 503; espera 550 ms",
      );
    });

    it.each([
      ["0", 1],
      ["1", 2],
    ])(
      "con PYTHON_API_REINTENTOS=%s hace %i intento(s)",
      async (reintentos, intentosEsperados) => {
        await crearServicio({ PYTHON_API_REINTENTOS: reintentos });
        responderEnOrden(errorAxios("ECONNREFUSED"));

        await capturarError();

        expect(intentos).toBe(intentosEsperados);
      },
    );
  });
});
