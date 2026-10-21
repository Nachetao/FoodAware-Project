import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { of, throwError } from "rxjs";
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

describe("FastApiClientService", () => {
  let service: FastApiClientService;
  let httpService: { get: jest.Mock };

  beforeEach(async () => {
    httpService = { get: jest.fn() };
    // Los errores simulados generan logs esperados; se silencian en la salida.
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FastApiClientService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(PYTHON_API_URL) },
        },
      ],
    }).compile();

    service = module.get(FastApiClientService);
  });

  afterEach(() => jest.restoreAllMocks());

  async function capturarError(): Promise<ContratoHttpException> {
    try {
      await service.buscar(PARAMETROS, REQUEST_ID);
    } catch (error) {
      return error;
    }
    throw new Error("Se esperaba que buscar() fallara");
  }

  describe("buscar", () => {
    it("llama a GET /search con los parámetros y el X-Request-ID", async () => {
      httpService.get.mockReturnValue(
        of(respuestaHttp(200, respuestaBusqueda)),
      );

      await service.buscar({ q: "pan", limit: 5, offset: 10 }, REQUEST_ID);

      expect(httpService.get).toHaveBeenCalledWith(`${PYTHON_API_URL}/search`, {
        params: { q: "pan", limit: 5, offset: 10 },
        headers: { "X-Request-ID": REQUEST_ID },
      });
    });

    it("devuelve el cuerpo de FastAPI sin modificarlo", async () => {
      httpService.get.mockReturnValue(
        of(respuestaHttp(200, respuestaBusqueda)),
      );

      const resultado = await service.buscar(PARAMETROS, REQUEST_ID);

      expect(resultado).toEqual(respuestaBusqueda);
    });

    it.each([
      [422, CodigoError.VALIDATION_ERROR],
      [500, CodigoError.INTERNAL_ERROR],
      [503, CodigoError.SOURCE_UNAVAILABLE],
      [504, CodigoError.SOURCE_TIMEOUT],
    ])(
      "propaga un %i del contrato con el mismo status y cuerpo",
      async (status, codigo) => {
        const cuerpo = errorContrato(codigo, "Error de FastAPI");
        httpService.get.mockReturnValue(
          throwError(() =>
            errorAxios("ERR_BAD_RESPONSE", respuestaHttp(status, cuerpo)),
          ),
        );

        const error = await capturarError();

        expect(error).toBeInstanceOf(ContratoHttpException);
        expect(error.getStatus()).toBe(status);
        expect(error.getResponse()).toEqual(cuerpo);
      },
    );

    it.each(["ECONNABORTED", "ETIMEDOUT"])(
      "responde 504 SOURCE_TIMEOUT si axios falla con %s",
      async (code) => {
        httpService.get.mockReturnValue(throwError(() => errorAxios(code)));

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
      httpService.get.mockReturnValue(
        throwError(() => errorAxios("ECONNREFUSED")),
      );

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
      ["el error nativo de FastAPI", { detail: "Not Found" }],
      [
        "un código fuera del contrato",
        { error: { codigo: "OTRO", mensaje: "x", request_id: REQUEST_ID } },
      ],
      ["un cuerpo de texto", "<html>Bad Gateway</html>"],
    ])("responde 502 INTERNAL_ERROR ante %s", async (_caso, cuerpo) => {
      httpService.get.mockReturnValue(
        throwError(() =>
          errorAxios("ERR_BAD_RESPONSE", respuestaHttp(404, cuerpo)),
        ),
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
      httpService.get.mockReturnValue(throwError(() => new Error("boom")));

      const error = await capturarError();

      expect(error.getStatus()).toBe(500);
      expect(error.getResponse()).toEqual(
        errorContrato(
          CodigoError.INTERNAL_ERROR,
          "Error interno al consultar el servicio de búsqueda",
        ),
      );
    });
  });
});
