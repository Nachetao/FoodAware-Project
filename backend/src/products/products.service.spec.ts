import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductsService } from "./products.service";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsRepository } from "./products.repository";
import { UsersService } from "../users/users.service";
import { AllergenCode } from "./contrato/enums";
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
  let fastApiClient: { buscar: jest.Mock; obtenerProducto: jest.Mock };
  let productsRepository: {
    guardar: jest.Mock;
    buscarRespaldo: jest.Mock;
    buscarPorCodigo: jest.Mock;
    buscarCompatibles: jest.Mock;
  };
  let logWarn: jest.SpyInstance;
  let logError: jest.SpyInstance;
  const usersService = { perfil: jest.fn() };

  beforeEach(async () => {
    fastApiClient = {
      buscar: jest.fn().mockResolvedValue(respuestaBusqueda),
      obtenerProducto: jest.fn().mockResolvedValue(leche),
    };
    productsRepository = {
      guardar: jest.fn().mockResolvedValue(undefined),
      buscarPorCodigo: jest.fn().mockResolvedValue(null),
      buscarCompatibles: jest.fn(),
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
        { provide: UsersService, useValue: usersService },
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

  describe("obtener (detalle de producto)", () => {
    it("devuelve el producto de FastAPI y lo guarda", async () => {
      const resultado = await service.obtener("7801234000018", REQUEST_ID);

      expect(fastApiClient.obtenerProducto).toHaveBeenCalledWith(
        "7801234000018",
        REQUEST_ID,
      );
      expect(productsRepository.guardar).toHaveBeenCalledWith([leche]);
      expect(resultado).toEqual({ respuesta: leche, fuente: "fastapi" });
    });

    it("responde igual si el guardado falla", async () => {
      productsRepository.guardar.mockRejectedValue(new Error("sin base"));

      const resultado = await service.obtener("7801234000018", REQUEST_ID);

      expect(resultado.fuente).toBe("fastapi");
    });

    it("propaga el 404 sin consultar la base", async () => {
      const error = errorFastApi(404, CodigoError.NOT_FOUND);
      fastApiClient.obtenerProducto.mockRejectedValue(error);

      await expect(service.obtener("7801234000018", REQUEST_ID)).rejects.toBe(
        error,
      );
      expect(productsRepository.buscarPorCodigo).not.toHaveBeenCalled();
    });

    it.each([500, 502, 503, 504])(
      "ante %i responde el producto guardado",
      async (status) => {
        fastApiClient.obtenerProducto.mockRejectedValue(
          errorFastApi(status, CodigoError.SOURCE_UNAVAILABLE),
        );
        productsRepository.buscarPorCodigo.mockResolvedValue(leche);

        const resultado = await service.obtener("7801234000018", REQUEST_ID);

        expect(resultado).toEqual({ respuesta: leche, fuente: "respaldo" });
        expect(productsRepository.guardar).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledWith(
          `[prueba-123] FastAPI falló con ${status} SOURCE_UNAVAILABLE; respondiendo el producto 7801234000018 desde la base`,
        );
      },
    );

    it("mantiene el error original si el producto no está en la base", async () => {
      const error = errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE);
      fastApiClient.obtenerProducto.mockRejectedValue(error);

      await expect(service.obtener("7801234000018", REQUEST_ID)).rejects.toBe(
        error,
      );
    });

    it("mantiene el error original si la base también falla", async () => {
      const error = errorFastApi(504, CodigoError.SOURCE_TIMEOUT);
      fastApiClient.obtenerProducto.mockRejectedValue(error);
      productsRepository.buscarPorCodigo.mockRejectedValue(
        new Error("conexión perdida"),
      );

      await expect(service.obtener("7801234000018", REQUEST_ID)).rejects.toBe(
        error,
      );
    });
  });

  describe("compatibilidad y compatibles", () => {
    const galletas = {
      codigo_barras: "7801234000018",
      alergenos: [AllergenCode.GLUTEN, AllergenCode.LACTEOS],
      trazas: [AllergenCode.MANI],
    } as Producto;

    beforeEach(() => {
      fastApiClient.obtenerProducto.mockResolvedValue(galletas);
      usersService.perfil.mockResolvedValue({
        id: "u1",
        alergias: [AllergenCode.LACTEOS, AllergenCode.MANI],
      });
    });

    it("no es apto si un alérgeno coincide e informa las trazas en conflicto", async () => {
      const resultado = await service.compatibilidad("7801234000018", "u1", REQUEST_ID);

      expect(usersService.perfil).toHaveBeenCalledWith("u1");
      expect(resultado).toEqual({
        respuesta: {
          apto: false,
          alergenos_en_conflicto: [AllergenCode.LACTEOS],
          trazas_en_conflicto: [AllergenCode.MANI],
        },
        fuente: "fastapi",
      });
    });

    it("las trazas en conflicto no lo hacen no apto", async () => {
      usersService.perfil.mockResolvedValue({ id: "u1", alergias: [AllergenCode.MANI] });

      const { respuesta } = await service.compatibilidad("7801234000018", "u1", REQUEST_ID);

      expect(respuesta).toEqual({
        apto: true,
        alergenos_en_conflicto: [],
        trazas_en_conflicto: [AllergenCode.MANI],
      });
    });

    it("informa si el producto vino del respaldo", async () => {
      fastApiClient.obtenerProducto.mockRejectedValue(
        errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE),
      );
      productsRepository.buscarPorCodigo.mockResolvedValue(galletas);

      const { fuente } = await service.compatibilidad("7801234000018", "u1", REQUEST_ID);

      expect(fuente).toBe("respaldo");
    });

    it("compatibles busca en la base excluyendo las alergias del usuario", async () => {
      productsRepository.buscarCompatibles.mockResolvedValue({
        total: 7,
        resultados: resultadosRespaldo,
      });

      const respuesta = await service.compatibles(PARAMETROS, "u1");

      expect(productsRepository.buscarCompatibles).toHaveBeenCalledWith(PARAMETROS, [
        AllergenCode.LACTEOS,
        AllergenCode.MANI,
      ]);
      expect(respuesta).toEqual({
        consulta: "leche",
        total: 7,
        tiempo_ms: expect.any(Number),
        resultados: resultadosRespaldo,
        estado_fuente: "cache",
      });
    });
  });
});
