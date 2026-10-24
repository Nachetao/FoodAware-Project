import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { ContratoHttpException } from "./contrato-http.exception";
import { RespuestaBusqueda } from "./contrato/busqueda";
import { CodigoError } from "./contrato/enums";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const respuestaBusqueda: RespuestaBusqueda = {
  consulta: "leche",
  total: 0,
  tiempo_ms: 0.1,
  resultados: [],
  estado_fuente: "online",
};

describe("ProductsController (GET /api/products/search)", () => {
  let app: INestApplication;
  let url: string;
  let productsService: { buscar: jest.Mock };

  beforeAll(async () => {
    productsService = { buscar: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: productsService }],
    }).compile();

    // Misma configuración que main.ts.
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/api/products/search`;
  });

  afterAll(() => app.close());

  beforeEach(() => {
    productsService.buscar.mockReset();
    productsService.buscar.mockResolvedValue({
      respuesta: respuestaBusqueda,
      fuente: "fastapi",
    });
  });

  function buscar(query: string, headers: Record<string, string> = {}) {
    return fetch(`${url}?${query}`, { headers });
  }

  it("devuelve la respuesta de FastAPI con los valores por defecto", async () => {
    const res = await buscar("q=leche");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(respuestaBusqueda);
    expect(productsService.buscar).toHaveBeenCalledWith(
      expect.objectContaining({ q: "leche", limit: 10, offset: 0 }),
      expect.any(String),
    );
  });

  it("convierte limit y offset a números", async () => {
    await buscar("q=pan&limit=5&offset=20");

    expect(productsService.buscar).toHaveBeenCalledWith(
      expect.objectContaining({ q: "pan", limit: 5, offset: 20 }),
      expect.any(String),
    );
  });

  it("reutiliza un X-Request-ID entrante válido", async () => {
    const res = await buscar("q=leche", { "X-Request-ID": "prueba-123" });

    expect(res.headers.get("x-request-id")).toBe("prueba-123");
    expect(productsService.buscar).toHaveBeenCalledWith(
      expect.anything(),
      "prueba-123",
    );
  });

  it.each([
    ["no viene", {}],
    ["tiene caracteres no permitidos", { "X-Request-ID": "id con espacios" }],
    ["supera 128 caracteres", { "X-Request-ID": "a".repeat(129) }],
  ])(
    "genera un uuid4 si el X-Request-ID %s",
    async (_caso, headers: Record<string, string>) => {
      const res = await buscar("q=leche", headers);

      const requestId = res.headers.get("x-request-id");
      expect(requestId).toMatch(UUID);
      expect(productsService.buscar).toHaveBeenCalledWith(
        expect.anything(),
        requestId,
      );
    },
  );

  it.each([
    ["sin q", "", "q debe tener entre 2 y 100 caracteres"],
    ["q de 1 carácter", "q=a", "q debe tener entre 2 y 100 caracteres"],
    [
      "q de 101 caracteres",
      `q=${"a".repeat(101)}`,
      "q debe tener entre 2 y 100 caracteres",
    ],
    ["limit 0", "q=leche&limit=0", "limit debe ser al menos 1"],
    ["limit 51", "q=leche&limit=51", "limit no puede ser mayor a 50"],
    [
      "limit no numérico",
      "q=leche&limit=abc",
      "limit debe ser un número entero",
    ],
    ["offset negativo", "q=leche&offset=-1", "offset no puede ser negativo"],
    [
      "un parámetro desconocido",
      "q=leche&userId=1",
      "property userId should not exist",
    ],
  ])(
    "responde 422 VALIDATION_ERROR con %s",
    async (_caso, query, mensajeEsperado) => {
      const res = await buscar(query, { "X-Request-ID": "prueba-422" });
      const cuerpo = await res.json();

      expect(res.status).toBe(422);
      expect(res.headers.get("x-request-id")).toBe("prueba-422");
      expect(cuerpo.error.codigo).toBe(CodigoError.VALIDATION_ERROR);
      expect(cuerpo.error.mensaje).toContain(mensajeEsperado);
      expect(cuerpo.error.request_id).toBe("prueba-422");
      expect(productsService.buscar).not.toHaveBeenCalled();
    },
  );

  it("devuelve el status y el cuerpo de los errores del contrato", async () => {
    const error = ContratoHttpException.crear(
      503,
      CodigoError.SOURCE_UNAVAILABLE,
      "El servicio de búsqueda no está disponible",
      "prueba-503",
    );
    productsService.buscar.mockRejectedValue(error);

    const res = await buscar("q=leche", { "X-Request-ID": "prueba-503" });

    expect(res.status).toBe(503);
    expect(res.headers.get("x-request-id")).toBe("prueba-503");
    expect(await res.json()).toEqual(error.getResponse());
  });

  it.each(["fastapi", "respaldo"])(
    "indica la fuente de los datos en X-Fuente-Datos (%s)",
    async (fuente) => {
      const respuesta = { ...respuestaBusqueda, estado_fuente: "cache" };
      productsService.buscar.mockResolvedValue({ respuesta, fuente });

      const res = await buscar("q=leche");

      expect(res.status).toBe(200);
      expect(res.headers.get("x-fuente-datos")).toBe(fuente);
      expect(await res.json()).toEqual(respuesta);
    },
  );
});
