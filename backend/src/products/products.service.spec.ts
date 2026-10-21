import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductsService } from "./products.service";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsRepository } from "./products.repository";
import { ContratoHttpException } from "./contrato-http.exception";
import { RespuestaBusqueda } from "./contrato/busqueda";
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

describe("ProductsService", () => {
  let service: ProductsService;
  let fastApiClient: { buscar: jest.Mock };
  let productsRepository: { guardar: jest.Mock };
  let logError: jest.SpyInstance;

  beforeEach(async () => {
    fastApiClient = {
      buscar: jest.fn().mockResolvedValue(respuestaBusqueda),
    };
    productsRepository = { guardar: jest.fn().mockResolvedValue(undefined) };
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

  it("busca en FastAPI y guarda los productos de los resultados", async () => {
    const respuesta = await service.buscar(PARAMETROS, REQUEST_ID);

    expect(fastApiClient.buscar).toHaveBeenCalledWith(PARAMETROS, REQUEST_ID);
    expect(productsRepository.guardar).toHaveBeenCalledWith([leche, pan]);
    expect(respuesta).toBe(respuestaBusqueda);
  });

  it("devuelve igual los resultados y registra el error si el guardado falla", async () => {
    productsRepository.guardar.mockRejectedValue(new Error("conexión perdida"));

    const respuesta = await service.buscar(PARAMETROS, REQUEST_ID);

    expect(respuesta).toBe(respuestaBusqueda);
    expect(logError).toHaveBeenCalledWith(
      "[prueba-123] No se pudieron guardar 2 productos: conexión perdida",
    );
  });

  it("no guarda nada y propaga el error si FastAPI falla", async () => {
    const error = ContratoHttpException.crear(
      503,
      CodigoError.SOURCE_UNAVAILABLE,
      "El servicio de búsqueda no está disponible",
      REQUEST_ID,
    );
    fastApiClient.buscar.mockRejectedValue(error);

    await expect(service.buscar(PARAMETROS, REQUEST_ID)).rejects.toBe(error);
    expect(productsRepository.guardar).not.toHaveBeenCalled();
  });
});
