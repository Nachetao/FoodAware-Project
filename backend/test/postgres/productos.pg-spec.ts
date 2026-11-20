import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource } from "typeorm";
import { FastApiFalso } from "../integracion/fastapi-falso";
import { crearAppPostgres, vaciarTablas } from "./app-postgres";
import { Producto } from "../../src/products/contrato/producto";
import { ProductsRepository } from "../../src/products/products.repository";

function producto(
  codigo_barras: string,
  nombre: string,
  extra: Partial<Producto> = {},
  recuperado_en = "2026-10-20T14:30:00Z",
): Producto {
  return {
    codigo_barras,
    nombre,
    marca: null,
    cantidad: "500 g",
    ingredientes_texto: null,
    ingredientes: [],
    alergenos: [],
    trazas: [],
    etiquetas_dieta: [],
    nutriscore: "b",
    imagen_url: null,
    procedencia: {
      fuente: "openfoodfacts",
      url_fuente: `https://world.openfoodfacts.org/product/${codigo_barras}`,
      recuperado_en,
      modificado_en_fuente: null,
      run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
      hash_contenido: "a".repeat(64),
    },
    calidad: { es_valido: true, problemas: [], completitud: 0.9 },
    ...extra,
  };
}

describe("PostgreSQL real: productos y búsqueda de respaldo", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let base: DataSource;
  let repositorio: ProductsRepository;

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, base } = await crearAppPostgres(fastapi.url));
    repositorio = app.get(ProductsRepository);
  });

  afterAll(async () => {
    await app?.close();
    await fastapi.apagar();
  });

  beforeEach(() => vaciarTablas(base));

  const codigos = (r: { resultados: Array<{ producto: Producto }> }) =>
    r.resultados.map((x) => x.producto.codigo_barras);
  const buscar = (q: string, limit = 20, offset = 0) =>
    repositorio.buscarRespaldo({ q, limit, offset });

  describe("guardar (upsert por codigo_barras)", () => {
    it("guarda y devuelve el producto igual al del contrato", async () => {
      const leche = producto("7801234000018", "Leche semidescremada", {
        marca: "Colun",
        ingredientes_texto: "Leche, vitaminas A y D3.",
        ingredientes: ["leche", "vitaminas a y d3"],
        alergenos: ["lacteos"] as Producto["alergenos"],
        trazas: ["soya"] as Producto["trazas"],
        etiquetas_dieta: ["vegetariano"] as Producto["etiquetas_dieta"],
        calidad: {
          es_valido: true,
          problemas: ["sin_imagen"],
          completitud: 0.75,
        },
      });

      await repositorio.guardar([leche]);

      expect(await repositorio.buscarPorCodigo("7801234000018")).toEqual(leche);
    });

    it("un dato más nuevo reemplaza al guardado y uno más antiguo no", async () => {
      const codigo = "7801234000025";
      await repositorio.guardar([
        producto(codigo, "Versión de octubre", {}, "2026-10-20T14:30:00Z"),
      ]);

      await repositorio.guardar([
        producto(codigo, "Versión de septiembre", {}, "2026-09-01T00:00:00Z"),
      ]);
      expect((await repositorio.buscarPorCodigo(codigo))?.nombre).toBe(
        "Versión de octubre",
      );

      await repositorio.guardar([
        producto(codigo, "Versión de noviembre", {}, "2026-11-01T00:00:00Z"),
      ]);
      expect((await repositorio.buscarPorCodigo(codigo))?.nombre).toBe(
        "Versión de noviembre",
      );
      const [{ total }] = await base.query(
        "SELECT count(*)::int AS total FROM products",
      );
      expect(total).toBe(1);
    });

    it("acepta códigos repetidos en un mismo lote sin fallar", async () => {
      await expect(
        repositorio.guardar([
          producto("7801234000032", "Primero"),
          producto("7801234000032", "Repetido"),
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe("buscarRespaldo (SQL de la búsqueda)", () => {
    beforeEach(async () => {
      await repositorio.guardar([
        producto("7800000000011", "Avena instantánea"),
        producto("7800000000028", "Granola", { marca: "Avena Sur" }),
        producto("7800000000035", "Barra de cereal", {
          ingredientes: ["trigo", "avena", "miel"],
        }),
        producto("7800000000042", "Avena vencida", {
          calidad: {
            es_valido: false,
            problemas: ["sin_nombre"],
            completitud: 0.2,
          },
        }),
        producto("7800000000059", "Pan integral"),
        producto("7800000000066", "Empanada de pino"),
        producto("7800000000073", "Harina de maíz"),
      ]);
    });

    it("ordena por puntaje: nombre (3) > marca (2) > ingredientes (1)", async () => {
      const r = await buscar("avena");

      expect(codigos(r)).toEqual([
        "7800000000011",
        "7800000000028",
        "7800000000035",
      ]);
      expect(r.resultados.map((x) => x.score)).toEqual([3, 2, 1]);
      expect(r.total).toBe(3);
    });

    it("excluye los productos que no son válidos", async () => {
      expect(codigos(await buscar("avena"))).not.toContain("7800000000042");
    });

    it("pagina con limit y offset y la posición es global", async () => {
      const r = await buscar("avena", 2, 1);

      expect(r.total).toBe(3);
      expect(codigos(r)).toEqual(["7800000000028", "7800000000035"]);
      expect(r.resultados.map((x) => x.posicion)).toEqual([2, 3]);
    });

    it("coincide por inicio de palabra: pan no encuentra empanada", async () => {
      expect(codigos(await buscar("pan"))).toEqual(["7800000000059"]);
    });

    it.each(["maiz", "MAÍZ", "maíz"])(
      "ignora tildes y mayúsculas en la base y en la consulta (%s)",
      async (q) => {
        expect(codigos(await buscar(q))).toEqual(["7800000000073"]);
      },
    );

    it("sin coincidencias responde total 0", async () => {
      expect(await buscar("chocolate")).toEqual({ total: 0, resultados: [] });
    });
  });

  it("con FastAPI caído, GET /api/products/search responde desde PostgreSQL", async () => {
    await repositorio.guardar([
      producto("7800000000011", "Galletas de avena"),
      producto("7800000000028", "Galletas de chocolate"),
    ]);
    await fastapi.apagar();

    const res = await request(app.getHttpServer()).get(
      "/api/products/search?q=galletas",
    );

    expect(res.status).toBe(200);
    expect(res.headers["x-fuente-datos"]).toBe("respaldo");
    expect(res.body.total).toBe(2);
    expect(
      res.body.resultados.map(
        (r: { producto: Producto }) => r.producto.codigo_barras,
      ),
    ).toEqual(["7800000000011", "7800000000028"]);
    await fastapi.encender();
  });
});
