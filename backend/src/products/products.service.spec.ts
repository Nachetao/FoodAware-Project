import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  MAX_PAGINAS_TOTAL_COMPATIBLES,
  ProductsService,
} from "./products.service";
import { FastApiClientService } from "./fastapi-client.service";
import { ProductsRepository } from "./products.repository";
import { UsersService } from "../users/users.service";
import { AllergenCode, DietLabel } from "./contrato/enums";
import { ContratoHttpException } from "./contrato-http.exception";
import { RespuestaBusqueda, ResultadoBusqueda } from "./contrato/busqueda";
import { CodigoError } from "./contrato/enums";
import { Producto } from "./contrato/producto";
import {
  RespuestaBusquedaPersonalizada,
  Veredicto,
} from "./contrato/adaptativo";
import { AVISO } from "./compatibilidad-local";

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
  let fastApiClient: {
    buscar: jest.Mock;
    obtenerProducto: jest.Mock;
    compatibilidad: jest.Mock;
    buscarPersonalizado: jest.Mock;
  };
  let productsRepository: {
    guardar: jest.Mock;
    buscarRespaldo: jest.Mock;
    buscarPorCodigo: jest.Mock;
    buscarCompatibles: jest.Mock;
    buscarPersonalizadoRespaldo: jest.Mock;
  };
  let logWarn: jest.SpyInstance;
  let logError: jest.SpyInstance;
  const usersService = { perfil: jest.fn() };

  beforeEach(async () => {
    fastApiClient = {
      buscar: jest.fn().mockResolvedValue(respuestaBusqueda),
      obtenerProducto: jest.fn().mockResolvedValue(leche),
      compatibilidad: jest.fn(),
      buscarPersonalizado: jest.fn(),
    };
    productsRepository = {
      guardar: jest.fn().mockResolvedValue(undefined),
      buscarPorCodigo: jest.fn().mockResolvedValue(null),
      buscarCompatibles: jest.fn(),
      buscarPersonalizadoRespaldo: jest.fn(),
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
      ingredientes: ["harina de trigo", "leche", "avena"],
      alergenos: [AllergenCode.GLUTEN, AllergenCode.LACTEOS],
      trazas: [AllergenCode.MANI],
      calidad: { es_valido: true, problemas: [], completitud: 0.9 },
    } as Producto;
    const veredictoMotor: Veredicto = {
      codigo_barras: "7801234000018",
      veredicto: "no_apto",
      alergenos_en_conflicto: [AllergenCode.LACTEOS],
      trazas_en_conflicto: [AllergenCode.MANI],
      dietas_no_confirmadas: [],
      conflictos: [
        { codigo: AllergenCode.LACTEOS, tipo: "alergeno", origen: "fuente" },
        { codigo: AllergenCode.MANI, tipo: "traza", origen: "fuente" },
      ],
      motivos_no_apto: [{ tipo: "alergeno", codigo: AllergenCode.LACTEOS }],
      datos_suficientes: true,
      explicacion: "Contiene lácteos, que está en tu perfil.",
      confianza: "alta",
      motivos_confianza: [],
      aviso: AVISO,
    };

    beforeEach(() => {
      fastApiClient.compatibilidad.mockResolvedValue(veredictoMotor);
      usersService.perfil.mockResolvedValue({
        id: "u1",
        nombre: "Ana",
        correo: "ana@correo.cl",
        alergias: [AllergenCode.LACTEOS, AllergenCode.MANI],
        dietas: [],
        modo_estricto: false,
        rol: "usuario",
      });
    });

    const compatibilidadDeGalletas = () =>
      service.compatibilidad("7801234000018", "u1", REQUEST_ID);

    it("envía al motor solo el perfil (sin id, nombre ni correo)", async () => {
      await compatibilidadDeGalletas();

      expect(usersService.perfil).toHaveBeenCalledWith("u1");
      expect(fastApiClient.compatibilidad).toHaveBeenCalledWith(
        "7801234000018",
        {
          alergias: [AllergenCode.LACTEOS, AllergenCode.MANI],
          dietas: [],
          modo_estricto: false,
        },
        REQUEST_ID,
      );
      expect(fastApiClient.obtenerProducto).not.toHaveBeenCalled();
    });

    it("envía las dietas y el modo estricto reales del usuario, nunca su identidad", async () => {
      usersService.perfil.mockResolvedValue({
        id: "u1",
        nombre: "Ana",
        correo: "ana@correo.cl",
        alergias: [AllergenCode.MANI],
        dietas: [DietLabel.VEGANO],
        modo_estricto: true,
        rol: "usuario",
      });

      await compatibilidadDeGalletas();

      const perfil = fastApiClient.compatibilidad.mock.calls[0][1];
      expect(perfil).toEqual({
        alergias: [AllergenCode.MANI],
        dietas: [DietLabel.VEGANO],
        modo_estricto: true,
      });
    });

    it("en respaldo aplica las dietas del perfil", async () => {
      usersService.perfil.mockResolvedValue({
        id: "u1",
        nombre: "Ana",
        correo: "ana@correo.cl",
        alergias: [],
        dietas: [DietLabel.VEGANO],
        modo_estricto: false,
        rol: "usuario",
      });
      fastApiClient.compatibilidad.mockRejectedValue(
        errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE),
      );
      productsRepository.buscarPorCodigo.mockResolvedValue(galletas);

      const { respuesta } = await compatibilidadDeGalletas();

      expect(respuesta.veredicto).toBe("no_apto");
      expect(respuesta.motivos_no_apto).toEqual([
        { tipo: "dieta", codigo: DietLabel.VEGANO },
      ]);
    });

    it("responde el Veredicto del motor completo más apto, con fuente fastapi", async () => {
      const resultado = await compatibilidadDeGalletas();

      expect(resultado).toEqual({
        respuesta: { ...veredictoMotor, apto: false },
        fuente: "fastapi",
      });
      expect(productsRepository.buscarPorCodigo).not.toHaveBeenCalled();
    });

    it.each([
      ["apto", true],
      ["apto_con_advertencia", false],
      ["no_apto", false],
    ] as const)(
      "con veredicto %s del motor, apto es %s",
      async (veredicto, apto) => {
        fastApiClient.compatibilidad.mockResolvedValue({
          ...veredictoMotor,
          veredicto,
        });

        const { respuesta } = await compatibilidadDeGalletas();

        expect(respuesta.veredicto).toBe(veredicto);
        expect(respuesta.apto).toBe(apto);
      },
    );

    it.each([
      [500, CodigoError.INTERNAL_ERROR],
      [502, CodigoError.INTERNAL_ERROR],
      [503, CodigoError.SOURCE_UNAVAILABLE],
      [504, CodigoError.SOURCE_TIMEOUT],
    ])(
      "si el motor falla con %i, responde la regla local sobre el producto guardado",
      async (status, codigo) => {
        fastApiClient.compatibilidad.mockRejectedValue(
          errorFastApi(status, codigo),
        );
        productsRepository.buscarPorCodigo.mockResolvedValue(galletas);

        const { respuesta, fuente } = await compatibilidadDeGalletas();

        expect(fuente).toBe("respaldo");
        expect(productsRepository.buscarPorCodigo).toHaveBeenCalledWith(
          "7801234000018",
        );
        expect(respuesta).toMatchObject({
          codigo_barras: "7801234000018",
          veredicto: "no_apto",
          apto: false,
          alergenos_en_conflicto: [AllergenCode.LACTEOS],
          confianza: "baja",
          aviso: AVISO,
        });
        expect(respuesta.motivos_confianza).toContain("evaluacion_de_respaldo");
        expect(respuesta.explicacion).toContain(
          "El servicio de evaluación no está disponible",
        );
      },
    );

    it("en respaldo nunca responde apto, aunque no haya conflictos", async () => {
      fastApiClient.compatibilidad.mockRejectedValue(
        errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE),
      );
      productsRepository.buscarPorCodigo.mockResolvedValue({
        ...galletas,
        alergenos: [AllergenCode.GLUTEN],
        trazas: [],
      });

      const { respuesta, fuente } = await compatibilidadDeGalletas();

      expect(fuente).toBe("respaldo");
      expect(respuesta.veredicto).toBe("apto_con_advertencia");
      expect(respuesta.apto).toBe(false);
      expect(respuesta.confianza).toBe("baja");
    });

    it("si el motor falla y el producto no está guardado, propaga el error", async () => {
      const error = errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE);
      fastApiClient.compatibilidad.mockRejectedValue(error);
      productsRepository.buscarPorCodigo.mockResolvedValue(null);

      await expect(compatibilidadDeGalletas()).rejects.toBe(error);
    });

    it("propaga el 404 del motor sin usar el respaldo", async () => {
      const error = errorFastApi(404, CodigoError.NOT_FOUND);
      fastApiClient.compatibilidad.mockRejectedValue(error);

      await expect(compatibilidadDeGalletas()).rejects.toBe(error);
      expect(productsRepository.buscarPorCodigo).not.toHaveBeenCalled();
    });
  });

  describe("búsqueda personalizada y compatibles", () => {
    const ALERGIAS = [AllergenCode.LACTEOS, AllergenCode.MANI];
    const galletas = {
      codigo_barras: "7801234000018",
      ingredientes: ["avena"],
      alergenos: [AllergenCode.GLUTEN],
      trazas: [],
      calidad: { es_valido: true, problemas: [], completitud: 0.9 },
    } as unknown as Producto;
    const conLeche = {
      ...galletas,
      codigo_barras: "7801234000025",
      alergenos: [AllergenCode.LACTEOS],
    } as Producto;
    const veredicto = (
      codigo: string,
      tipo: Veredicto["veredicto"],
    ): Veredicto => ({
      codigo_barras: codigo,
      veredicto: tipo,
      alergenos_en_conflicto: [],
      trazas_en_conflicto: [],
      dietas_no_confirmadas: [],
      conflictos: [],
      motivos_no_apto: [],
      datos_suficientes: true,
      explicacion: "x",
      confianza: "alta",
      motivos_confianza: [],
      aviso: AVISO,
    });
    const respuestaMotor = (
      resultados: Array<[Producto, Veredicto["veredicto"]]>,
    ): RespuestaBusquedaPersonalizada => ({
      consulta: "galletas",
      interpretacion: {
        terminos: ["galleta"],
        restricciones: [],
        no_reconocidas: [],
      },
      perfil_aplicado: { alergias: ALERGIAS, dietas: [], modo_estricto: true },
      modo: "filtrar",
      total: resultados.length,
      total_base: 9,
      tiempo_ms: 1.8,
      estado_fuente: "online",
      resultados: resultados.map(([producto, tipo], i) => ({
        producto,
        score: 3 - i,
        posicion: i + 1,
        posicion_base: i + 2,
        veredicto: veredicto(producto.codigo_barras, tipo),
      })),
      no_aptos: { total: 0, ocultos: true, motivos: [], texto: "" },
      comparacion: { k: 5, top_base: [], top_personalizado: [] },
      aviso: AVISO,
    });
    const PARAMS = { q: "galletas", limit: 10, offset: 0 };
    const caido = () => errorFastApi(503, CodigoError.SOURCE_UNAVAILABLE);

    beforeEach(() => {
      usersService.perfil.mockResolvedValue({
        id: "u1",
        nombre: "Ana",
        correo: "ana@correo.cl",
        alergias: ALERGIAS,
        dietas: [],
        modo_estricto: false,
        rol: "usuario",
      });
    });

    describe("buscarPersonalizado", () => {
      it("envía la consulta, el modo y solo el perfil, y responde lo del motor", async () => {
        const motor = respuestaMotor([[galletas, "apto"]]);
        fastApiClient.buscarPersonalizado.mockResolvedValue(motor);

        const resultado = await service.buscarPersonalizado(
          PARAMS,
          "reordenar",
          "u1",
          REQUEST_ID,
        );

        expect(fastApiClient.buscarPersonalizado).toHaveBeenCalledWith(
          {
            consulta: "galletas",
            perfil: { alergias: ALERGIAS, dietas: [], modo_estricto: false },
            modo: "reordenar",
            limit: 10,
            offset: 0,
          },
          REQUEST_ID,
        );
        expect(resultado).toEqual({ respuesta: motor, fuente: "fastapi" });
        expect(productsRepository.guardar).toHaveBeenCalledWith([galletas]);
      });

      it("si el motor falla, ordena los guardados con la regla local (nunca apto)", async () => {
        fastApiClient.buscarPersonalizado.mockRejectedValue(caido());
        productsRepository.buscarPersonalizadoRespaldo.mockResolvedValue({
          total: 1,
          total_base: 3,
          no_aptos: 2,
          motivos: [
            { tipo: "alergeno", codigo: AllergenCode.LACTEOS, cantidad: 2 },
            { tipo: "alergeno", codigo: AllergenCode.MANI, cantidad: 1 },
          ],
          resultados: [{ producto: galletas, score: 3, posicion: 1 }],
        });

        const { respuesta, fuente } = await service.buscarPersonalizado(
          { q: "Galletas de AVENA", limit: 10, offset: 0 },
          "filtrar",
          "u1",
          REQUEST_ID,
        );

        expect(fuente).toBe("respaldo");
        expect(
          productsRepository.buscarPersonalizadoRespaldo,
        ).toHaveBeenCalledWith(
          { q: "Galletas de AVENA", limit: 10, offset: 0 },
          { alergias: ALERGIAS, dietas: [], modo_estricto: false },
          "filtrar",
        );
        expect(respuesta).toMatchObject({
          consulta: "Galletas de AVENA",
          interpretacion: {
            terminos: ["galleta", "avena"],
            restricciones: [],
            no_reconocidas: [],
          },
          perfil_aplicado: {
            alergias: ALERGIAS,
            dietas: [],
            modo_estricto: false,
          },
          modo: "filtrar",
          total: 1,
          total_base: 3,
          estado_fuente: "cache",
          no_aptos: {
            total: 2,
            ocultos: true,
            motivos: [
              { tipo: "alergeno", codigo: "lacteos", cantidad: 2 },
              { tipo: "alergeno", codigo: "mani", cantidad: 1 },
            ],
            texto: "2 ocultos: 2 por contener lácteos y 1 por contener maní.",
          },
          comparacion: null,
          aviso: AVISO,
        });
        const [resultado] = respuesta.resultados;
        expect(resultado).toMatchObject({
          producto: galletas,
          score: 3,
          posicion: 1,
          posicion_base: null,
        });
        expect(resultado.veredicto.veredicto).toBe("apto_con_advertencia");
        expect(resultado.veredicto.confianza).toBe("baja");
        expect(resultado.veredicto.motivos_confianza).toContain(
          "evaluacion_de_respaldo",
        );
      });

      it("en reordenar, los no aptos de respaldo no van ocultos", async () => {
        fastApiClient.buscarPersonalizado.mockRejectedValue(caido());
        productsRepository.buscarPersonalizadoRespaldo.mockResolvedValue({
          total: 2,
          total_base: 2,
          no_aptos: 1,
          motivos: [
            { tipo: "alergeno", codigo: AllergenCode.LACTEOS, cantidad: 1 },
          ],
          resultados: [
            { producto: galletas, score: 3, posicion: 1 },
            { producto: conLeche, score: 3, posicion: 2 },
          ],
        });

        const { respuesta } = await service.buscarPersonalizado(
          PARAMS,
          "reordenar",
          "u1",
          REQUEST_ID,
        );

        expect(respuesta.no_aptos).toMatchObject({
          ocultos: false,
          texto: "1 no apto al final por contener lácteos.",
        });
        expect(respuesta.resultados.map((r) => r.veredicto.veredicto)).toEqual([
          "apto_con_advertencia",
          "no_apto",
        ]);
      });

      it("si el motor falla y la base no tiene coincidencias, mantiene el error", async () => {
        const error = caido();
        fastApiClient.buscarPersonalizado.mockRejectedValue(error);
        productsRepository.buscarPersonalizadoRespaldo.mockResolvedValue({
          total: 0,
          total_base: 0,
          no_aptos: 0,
          motivos: [],
          resultados: [],
        });

        await expect(
          service.buscarPersonalizado(PARAMS, "filtrar", "u1", REQUEST_ID),
        ).rejects.toBe(error);
      });

      it("si la base también falla, mantiene el error del motor", async () => {
        const error = caido();
        fastApiClient.buscarPersonalizado.mockRejectedValue(error);
        productsRepository.buscarPersonalizadoRespaldo.mockRejectedValue(
          new Error("sin base"),
        );

        await expect(
          service.buscarPersonalizado(PARAMS, "filtrar", "u1", REQUEST_ID),
        ).rejects.toBe(error);
        expect(logError).toHaveBeenCalled();
      });

      it("un 4xx del motor se propaga sin respaldo", async () => {
        const error = errorFastApi(422, CodigoError.VALIDATION_ERROR);
        fastApiClient.buscarPersonalizado.mockRejectedValue(error);

        await expect(
          service.buscarPersonalizado(PARAMS, "filtrar", "u1", REQUEST_ID),
        ).rejects.toBe(error);
        expect(
          productsRepository.buscarPersonalizadoRespaldo,
        ).not.toHaveBeenCalled();
      });
    });

    describe("compatibles", () => {
      it("usa el motor en modo filtrar y estricto, y responde con la forma de /search", async () => {
        fastApiClient.buscarPersonalizado.mockResolvedValue(
          respuestaMotor([[galletas, "apto"]]),
        );

        const resultado = await service.compatibles(PARAMS, "u1", REQUEST_ID);

        expect(fastApiClient.buscarPersonalizado).toHaveBeenCalledWith(
          {
            consulta: "galletas",
            perfil: { alergias: ALERGIAS, dietas: [], modo_estricto: true },
            modo: "filtrar",
            limit: 10,
            offset: 0,
          },
          REQUEST_ID,
        );
        expect(resultado).toEqual({
          respuesta: {
            consulta: "galletas",
            total: 1,
            tiempo_ms: 1.8,
            resultados: [{ producto: galletas, score: 3, posicion: 1 }],
            estado_fuente: "online",
          },
          fuente: "fastapi",
        });
        expect(productsRepository.guardar).toHaveBeenCalledWith([galletas]);
        expect(productsRepository.buscarCompatibles).not.toHaveBeenCalled();
      });

      it('nunca muestra algo que no sea "apto", aunque el motor lo devuelva', async () => {
        fastApiClient.buscarPersonalizado.mockResolvedValue(
          respuestaMotor([
            [galletas, "apto"],
            [conLeche, "apto_con_advertencia"],
          ]),
        );

        const { respuesta } = await service.compatibles(
          PARAMS,
          "u1",
          REQUEST_ID,
        );

        expect(
          respuesta.resultados.map((r) => r.producto.codigo_barras),
        ).toEqual(["7801234000018"]);
        expect(respuesta.total).toBe(1);
        // La página ya muestra dónde terminan los apto: no pide más.
        expect(fastApiClient.buscarPersonalizado).toHaveBeenCalledTimes(1);
      });

      it("si el motor falla, busca en la base con el perfil en modo estricto", async () => {
        fastApiClient.buscarPersonalizado.mockRejectedValue(caido());
        productsRepository.buscarCompatibles.mockResolvedValue({
          total: 7,
          resultados: resultadosRespaldo,
        });

        const resultado = await service.compatibles(
          PARAMETROS,
          "u1",
          REQUEST_ID,
        );

        expect(productsRepository.buscarCompatibles).toHaveBeenCalledWith(
          PARAMETROS,
          { alergias: ALERGIAS, dietas: [], modo_estricto: true },
        );
        expect(resultado).toEqual({
          respuesta: {
            consulta: "leche",
            total: 7,
            tiempo_ms: expect.any(Number),
            resultados: resultadosRespaldo,
            estado_fuente: "cache",
          },
          fuente: "respaldo",
        });
      });

      it("si la base también falla, mantiene el error del motor", async () => {
        const error = caido();
        fastApiClient.buscarPersonalizado.mockRejectedValue(error);
        productsRepository.buscarCompatibles.mockRejectedValue(
          new Error("sin base"),
        );

        await expect(
          service.compatibles(PARAMS, "u1", REQUEST_ID),
        ).rejects.toBe(error);
      });

      describe("total con dietas (apto primero, después advertencias)", () => {
        // Página del motor: `aptos` apto seguidos de `resto` advertencias,
        // con `total` visibles en modo filtrar.
        const pagina = (
          aptos: number,
          resto: number,
          total: number,
        ): RespuestaBusquedaPersonalizada => {
          const tipos = [
            ...Array<Veredicto["veredicto"]>(aptos).fill("apto"),
            ...Array<Veredicto["veredicto"]>(resto).fill(
              "apto_con_advertencia",
            ),
          ];
          return {
            ...respuestaMotor(tipos.map((tipo) => [galletas, tipo])),
            total,
          };
        };
        const offsetsPedidos = () =>
          fastApiClient.buscarPersonalizado.mock.calls.map(
            ([cuerpo]) => cuerpo.offset,
          );

        beforeEach(() => {
          usersService.perfil.mockResolvedValue({
            id: "u1",
            nombre: "Ana",
            correo: "ana@correo.cl",
            alergias: ALERGIAS,
            dietas: [DietLabel.VEGANO],
            modo_estricto: false,
            rol: "usuario",
          });
        });

        it("envía las dietas reales y fuerza el modo estricto", async () => {
          fastApiClient.buscarPersonalizado.mockResolvedValue(pagina(1, 0, 1));

          await service.compatibles(PARAMS, "u1", REQUEST_ID);

          expect(
            fastApiClient.buscarPersonalizado.mock.calls[0][0].perfil,
          ).toEqual({
            alergias: ALERGIAS,
            dietas: [DietLabel.VEGANO],
            modo_estricto: true,
          });
        });

        it("con la página llena de apto, pide más páginas de 50 hasta el primero que no lo es", async () => {
          fastApiClient.buscarPersonalizado
            .mockResolvedValueOnce(pagina(10, 0, 200))
            .mockResolvedValueOnce(pagina(50, 0, 200))
            .mockResolvedValueOnce(pagina(7, 43, 200));

          const { respuesta } = await service.compatibles(
            PARAMS,
            "u1",
            REQUEST_ID,
          );

          expect(respuesta.resultados).toHaveLength(10);
          expect(respuesta.total).toBe(67);
          expect(offsetsPedidos()).toEqual([0, 10, 60]);
          expect(fastApiClient.buscarPersonalizado.mock.calls[1][0].limit).toBe(
            50,
          );
        });

        it(`se detiene tras ${MAX_PAGINAS_TOTAL_COMPATIBLES} páginas extra, responde lo contado y avisa en el log`, async () => {
          fastApiClient.buscarPersonalizado
            .mockResolvedValueOnce(pagina(10, 0, 1000))
            .mockResolvedValue(pagina(50, 0, 1000));

          const { respuesta } = await service.compatibles(
            PARAMS,
            "u1",
            REQUEST_ID,
          );

          expect(fastApiClient.buscarPersonalizado).toHaveBeenCalledTimes(
            1 + MAX_PAGINAS_TOTAL_COMPATIBLES,
          );
          expect(respuesta.total).toBe(10 + 50 * MAX_PAGINAS_TOTAL_COMPATIBLES);
          expect(logWarn).toHaveBeenCalledWith(
            expect.stringContaining("alcanzó el tope"),
          );
        });

        it("si los apto terminan justo al final de los resultados, no pide más", async () => {
          fastApiClient.buscarPersonalizado.mockResolvedValue(
            pagina(10, 0, 10),
          );

          const { respuesta } = await service.compatibles(
            PARAMS,
            "u1",
            REQUEST_ID,
          );

          expect(respuesta.total).toBe(10);
          expect(fastApiClient.buscarPersonalizado).toHaveBeenCalledTimes(1);
        });

        it("una página pedida después de los apto vuelve a contarlos desde el inicio", async () => {
          fastApiClient.buscarPersonalizado
            .mockResolvedValueOnce(pagina(0, 10, 40))
            .mockResolvedValueOnce(pagina(12, 28, 40));

          const { respuesta } = await service.compatibles(
            { q: "galletas", limit: 10, offset: 20 },
            "u1",
            REQUEST_ID,
          );

          expect(respuesta.resultados).toEqual([]);
          expect(respuesta.total).toBe(12);
          expect(offsetsPedidos()).toEqual([20, 0]);
        });

        it("si falla una página extra, responde lo contado y avisa en el log", async () => {
          fastApiClient.buscarPersonalizado
            .mockResolvedValueOnce(pagina(10, 0, 100))
            .mockRejectedValueOnce(caido());

          const { respuesta, fuente } = await service.compatibles(
            PARAMS,
            "u1",
            REQUEST_ID,
          );

          expect(fuente).toBe("fastapi");
          expect(respuesta.total).toBe(10);
          expect(logWarn).toHaveBeenCalledWith(
            expect.stringContaining("no pudo contar todos los apto"),
          );
        });
      });
    });
  });
});
