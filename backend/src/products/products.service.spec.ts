import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductsService } from "./products.service";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsRepository } from "./products.repository";
import { ContratoHttpException } from "./contrato-http.exception";
import { RespuestaBusqueda, ResultadoBusqueda } from "./contrato/busqueda";
import { CodigoError } from "./contrato/enums";
import { Producto } from "./contrato/producto";

const REQUEST_ID = "prueba-123";
const PARAMETROS = { q: "leche", limit: 10, offset: 0 };

const leche = { codigo_barras: "7801234000018" } as Producto;
const pan = { codigo_barras: "7805678000023" } as Producto;

const respuestaBusqueda: RespuestaBusqueda = {
  consulta: "leche",
  total: 2,
  tiempo_ms: 0.5,
  estado_fuente: "online",
  resultados: [
    { producto: leche, score: 2, posicion: 1 },
    { producto: pan, score: 1, posicion: 2 },
  ],
};

const resultadosRespaldo: ResultadoBusqueda[] = [
  { producto: leche, score: 3, posicion: 1 },
];

function errorFastApi(status: number, codigo: CodigoError) {
  return ContratoHttpException.crear(
    status,
    codigo,
    "Error de FastAPI",
    REQUEST_ID,
  );
}

describe("ProductsService", () => {
  let service: ProductsService;
  let fastApiClient: { buscar: jest.Mock };
  let productsRepository: { guardar: jest.Mock; buscarRespaldo: jest.Mock };
  let logWarn: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeEach(async () => {
    fastApiClient = {
      buscar: jest.fn().mockResolvedValue(respuestaBusqueda),
    };
    productsRepository = {
      guardar: jest.fn().mockResolvedValue(undefined),
      buscarRespaldo: jest
        .fn()
        .mockResolvedValue({ total: 7, resultados: resultadosRespaldo }),
    };
    logWarn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    logError = jest.spyOn(Logger.prototype, "error").mockImplementation();

    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: FastApiClientService, useValue: fastApiClient },
        { provide: ProductsRepository, useValue: productsRepository },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("con FastAPI disponible", () => {
    it("busca en FastAPI y guarda los productos de los resultados", async () => {
      const resultado = await service.buscar(PARAMETROS, REQUEST_ID);

      expect(fastApiClient.buscar).toHaveBeenCalledWith(PARAMETROS, REQUEST_ID);
      expect(productsRepository.guardar).toHaveBeenCalledWith([leche, pan]);
      expect(resultado).toEqual({
        respuesta: respuestaBusqueda,
        fuente: "fastapi",
      });
      expect(productsRepository.buscarRespaldo).not.toHaveBeenCalled();
    });

    it("devuelve igual los resultados y registra el error si el guardado falla", async () => {
      productsRepository.guardar.mockRejectedValue(
        new Error("conexión perdida"),
      );

      const resultado = await service.buscar(PARAMETROS, REQUEST_ID);

      expect(resultado.respuesta).toBe(respuestaBusqueda);
      expect(logError).toHaveBeenCalledWith(
        "[prueba-123] No se pudieron guardar 2 productos: conexión perdida",
      );
    });
  });

  describe("respaldo desde la base", () => {
    it.each([
      [500, CodigoError.INTERNAL_ERROR],
      [502, CodigoError.INTERNAL_ERROR],
      [503, CodigoError.SOURCE_UNAVAILABLE],
      [504, CodigoError.SOURCE_TIMEOUT],
    ])(
      "responde desde la base si FastAPI falla con %i",
      async (status, codigo) => {
        fastApiClient.buscar.mockRejectedValue(errorFastApi(status, codigo));

        const { respuesta, fuente } = await service.buscar(
          PARAMETROS,
          REQUEST_ID,
        );

        expect(fuente).toBe("respaldo");
        expect(productsRepository.buscarRespaldo).toHaveBeenCalledWith(
          PARAMETROS,
        );
        expect(respuesta).toEqual({
          consulta: "leche",
          total: 7,
          tiempo_ms: expect.any(Number),
          resultados: resultadosRespaldo,
          estado_fuente: "cache",
        });
        expect(logWarn).toHaveBeenCalledWith(
          `[prueba-123] FastAPI falló con ${status} ${codigo}; respondiendo desde la base: 1 de 7 productos`,
        );
      },
    );

    it("no vuelve a guardar los productos que vienen de la base", async () => {
      fastApiClient.buscar.mockRejectedValue(
        errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE),
      );

      await service.buscar(PARAMETROS, REQUEST_ID);

      expect(productsRepository.guardar).not.toHaveBeenCalled();
    });

    it.each([
      [422, CodigoError.VALIDATION_ERROR],
      [404, CodigoError.NOT_FOUND],
    ])("no usa el respaldo ante un %i", async (status, codigo) => {
      const error = errorFastApi(status, codigo);
      fastApiClient.buscar.mockRejectedValue(error);

      await expect(service.buscar(PARAMETROS, REQUEST_ID)).rejects.toBe(error);
      expect(productsRepository.buscarRespaldo).not.toHaveBeenCalled();
    });

    it("no usa el respaldo ante un error que no es del contrato", async () => {
      const error = new Error("inesperado");
      fastApiClient.buscar.mockRejectedValue(error);

      await expect(service.buscar(PARAMETROS, REQUEST_ID)).rejects.toBe(error);
      expect(productsRepository.buscarRespaldo).not.toHaveBeenCalled();
    });

    it("mantiene el error original si la base no tiene resultados", async () => {
      const error = errorFastApi(504, CodigoError.SOURCE_TIMEOUT);
      fastApiClient.buscar.mockRejectedValue(error);
      productsRepository.buscarRespaldo.mockResolvedValue({
        total: 0,
        resultados: [],
      });

      await expect(service.buscar(PARAMETROS, REQUEST_ID)).rejects.toBe(error);
      expect(logWarn).toHaveBeenCalledWith(
        "[prueba-123] FastAPI falló con 504 SOURCE_TIMEOUT y el respaldo no tiene resultados; se mantiene el error",
      );
    });

    it("mantiene el error original si la base también falla", async () => {
      const error = errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE);
      fastApiClient.buscar.mockRejectedValue(error);
      productsRepository.buscarRespaldo.mockRejectedValue(
        new Error("conexión perdida"),
      );

      await expect(service.buscar(PARAMETROS, REQUEST_ID)).rejects.toBe(error);
      expect(logError).toHaveBeenCalledWith(
        "[prueba-123] FastAPI falló con 503 SOURCE_UNAVAILABLE y el respaldo también falló: conexión perdida",
      );
    });
  });
});
