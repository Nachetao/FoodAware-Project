import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ProductsRepository } from "./products.repository";
import { Product } from "./entities/product.entity";
import { Producto } from "./contrato/producto";
import { AllergenCode, DietLabel } from "./contrato/enums";

function crearProducto(
  codigo_barras: string,
  recuperado_en = "2026-10-20T14:30:00Z",
  nombre = "Leche semidescremada",
): Producto {
  return {
    codigo_barras,
    nombre,
    marca: null,
    cantidad: "1 L",
    ingredientes_texto: "Leche, vitaminas A, D3.",
    ingredientes: ["leche", "vitaminas A, D3"],
    alergenos: [AllergenCode.LACTEOS],
    trazas: [],
    etiquetas_dieta: [DietLabel.VEGETARIANO],
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
    calidad: { es_valido: true, problemas: ["sin_imagen"], completitud: 0.9 },
  };
}

// Fila tal como la devuelve pg: fechas como Date y score de la consulta.
function filaGuardada(codigo_barras: string, score: number) {
  return {
    codigo_barras,
    nombre: "Leche semidescremada",
    marca: "Colun",
    cantidad: "1 L",
    ingredientes_texto: "Leche, vitaminas A, D3.",
    ingredientes: ["leche", "vitaminas A, D3"],
    alergenos: ["lacteos"],
    trazas: [],
    etiquetas_dieta: [],
    nutriscore: null,
    imagen_url: null,
    fuente: "openfoodfacts",
    url_fuente: `https://world.openfoodfacts.org/product/${codigo_barras}`,
    recuperado_en: new Date("2026-10-20T14:30:00.000Z"),
    modificado_en_fuente: null,
    run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
    hash_contenido: "a".repeat(64),
    es_valido: true,
    problemas: [],
    completitud: 0.8,
    creado_en: new Date(),
    actualizado_en: new Date(),
    score,
  };
}

describe("ProductsRepository", () => {
  let repository: ProductsRepository;
  let qb: Record<string, jest.Mock | string | ((n: string) => string)>;
  let typeormRepository: {
    createQueryBuilder: jest.Mock;
    query: jest.Mock;
    findOne: jest.Mock;
    metadata: object;
  };

  beforeEach(async () => {
    qb = { alias: "Product", escape: (nombre: string) => `"${nombre}"` };
    for (const metodo of ["insert", "values", "orUpdate", "updateEntity"]) {
      qb[metodo] = jest.fn().mockReturnValue(qb);
    }
    qb.execute = jest.fn().mockResolvedValue({});

    typeormRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      query: jest.fn(),
      findOne: jest.fn(),
      metadata: {
        columns: [
          { databaseName: "codigo_barras", isPrimary: true },
          { databaseName: "nombre" },
          { databaseName: "ingredientes" },
          { databaseName: "recuperado_en" },
          { databaseName: "creado_en", isCreateDate: true },
          { databaseName: "actualizado_en", isUpdateDate: true },
        ],
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ProductsRepository,
        { provide: getRepositoryToken(Product), useValue: typeormRepository },
      ],
    }).compile();

    repository = module.get(ProductsRepository);
  });

  const filasInsertadas = () => (qb.values as jest.Mock).mock.calls[0][0];

  it("inserta los productos mapeados a columnas en un solo INSERT", async () => {
    await repository.guardar([crearProducto("7801234000018")]);

    expect(typeormRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(qb.execute).toHaveBeenCalledTimes(1);
    expect(filasInsertadas()).toEqual([
      {
        codigo_barras: "7801234000018",
        nombre: "Leche semidescremada",
        marca: null,
        cantidad: "1 L",
        ingredientes_texto: "Leche, vitaminas A, D3.",
        ingredientes: ["leche", "vitaminas A, D3"],
        alergenos: ["lacteos"],
        trazas: [],
        etiquetas_dieta: ["vegetariano"],
        nutriscore: "b",
        imagen_url: null,
        fuente: "openfoodfacts",
        url_fuente: "https://world.openfoodfacts.org/product/7801234000018",
        recuperado_en: new Date("2026-10-20T14:30:00Z"),
        modificado_en_fuente: null,
        run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
        hash_contenido: "a".repeat(64),
        es_valido: true,
        problemas: ["sin_imagen"],
        completitud: 0.9,
      },
    ]);
  });

  it("actualiza por codigo_barras sin duplicar, solo si el dato no es más antiguo", async () => {
    await repository.guardar([crearProducto("7801234000018")]);

    expect(qb.orUpdate).toHaveBeenCalledWith(
      ["nombre", "ingredientes", "recuperado_en"],
      ["codigo_barras"],
      {
        overwriteCondition: {
          where: `EXCLUDED."recuperado_en" >= "Product"."recuperado_en"`,
        },
      },
    );
  });

  it("deja un solo producto por código repetido, el más reciente", async () => {
    await repository.guardar([
      crearProducto("7801234000018", "2026-10-20T10:00:00Z", "Versión vieja"),
      crearProducto("7805678000023"),
      crearProducto("7801234000018", "2026-10-20T12:00:00Z", "Versión nueva"),
      crearProducto("7801234000018", "2026-10-20T11:00:00Z", "Versión media"),
    ]);

    const filas = filasInsertadas();
    expect(filas.map((f) => f.codigo_barras)).toEqual([
      "7801234000018",
      "7805678000023",
    ]);
    expect(filas[0].nombre).toBe("Versión nueva");
  });

  it("no consulta la base si no hay productos", async () => {
    await repository.guardar([]);

    expect(typeormRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("propaga el error si falla el INSERT", async () => {
    (qb.execute as jest.Mock).mockRejectedValue(new Error("conexión perdida"));

    await expect(
      repository.guardar([crearProducto("7801234000018")]),
    ).rejects.toThrow("conexión perdida");
  });

  describe("buscarRespaldo", () => {
    it("cuenta y pagina con los tokens normalizados de la consulta", async () => {
      typeormRepository.query
        .mockResolvedValueOnce([{ total: 37 }])
        .mockResolvedValueOnce([filaGuardada("7801234000018", 6)]);

      await repository.buscarRespaldo({
        q: "Galletas de AVENA",
        limit: 20,
        offset: 40,
      });

      const [[sqlTotal, paramsTotal], [sqlPagina, paramsPagina]] =
        typeormRepository.query.mock.calls;
      expect(sqlTotal).toContain("count(*)");
      expect(paramsTotal).toEqual([["galleta", "avena"]]);
      expect(sqlPagina).toContain("LIMIT $2 OFFSET $3");
      expect(paramsPagina).toEqual([["galleta", "avena"], 20, 40]);
    });

    it("devuelve los productos con la forma del contrato, el score y la posición global", async () => {
      typeormRepository.query
        .mockResolvedValueOnce([{ total: 37 }])
        .mockResolvedValueOnce([
          filaGuardada("7801234000018", 6),
          filaGuardada("7805678000023", 3),
        ]);

      const { total, resultados } = await repository.buscarRespaldo({
        q: "leche",
        limit: 20,
        offset: 20,
      });

      expect(total).toBe(37);
      expect(resultados.map((r) => [r.posicion, r.score])).toEqual([
        [21, 6],
        [22, 3],
      ]);
      expect(resultados[0].producto).toEqual({
        codigo_barras: "7801234000018",
        nombre: "Leche semidescremada",
        marca: "Colun",
        cantidad: "1 L",
        ingredientes_texto: "Leche, vitaminas A, D3.",
        ingredientes: ["leche", "vitaminas A, D3"],
        alergenos: ["lacteos"],
        trazas: [],
        etiquetas_dieta: [],
        nutriscore: null,
        imagen_url: null,
        procedencia: {
          fuente: "openfoodfacts",
          url_fuente: "https://world.openfoodfacts.org/product/7801234000018",
          recuperado_en: "2026-10-20T14:30:00Z",
          modificado_en_fuente: null,
          run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
          hash_contenido: "a".repeat(64),
        },
        calidad: { es_valido: true, problemas: [], completitud: 0.8 },
      });
    });

    it("no pide la página si no hay coincidencias", async () => {
      typeormRepository.query.mockResolvedValueOnce([{ total: 0 }]);

      const resultado = await repository.buscarRespaldo({
        q: "zzzz",
        limit: 20,
        offset: 0,
      });

      expect(resultado).toEqual({ total: 0, resultados: [] });
      expect(typeormRepository.query).toHaveBeenCalledTimes(1);
    });

    it("no consulta la base si la consulta no tiene tokens útiles", async () => {
      const resultado = await repository.buscarRespaldo({
        q: "de la",
        limit: 20,
        offset: 0,
      });

      expect(resultado).toEqual({ total: 0, resultados: [] });
      expect(typeormRepository.query).not.toHaveBeenCalled();
    });

    it("propaga el error si falla la consulta", async () => {
      typeormRepository.query.mockRejectedValue(new Error("conexión perdida"));

      await expect(
        repository.buscarRespaldo({ q: "leche", limit: 20, offset: 0 }),
      ).rejects.toThrow("conexión perdida");
    });
  });

  describe("buscarPorCodigo", () => {
    it("devuelve el producto guardado con la forma del contrato", async () => {
      const fila = {
        ...crearProducto("7801234000018"),
        fuente: "openfoodfacts",
        url_fuente: "https://world.openfoodfacts.org/product/7801234000018",
        recuperado_en: new Date("2026-10-20T14:30:00.000Z"),
        modificado_en_fuente: null,
        run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
        hash_contenido: "a".repeat(64),
        es_valido: true,
        problemas: ["sin_imagen"],
        completitud: 0.9,
      };
      typeormRepository.findOne.mockResolvedValue(fila);

      const producto = await repository.buscarPorCodigo("7801234000018");

      expect(typeormRepository.findOne).toHaveBeenCalledWith({
        where: { codigo_barras: "7801234000018" },
      });
      expect(producto).toEqual(crearProducto("7801234000018"));
    });

    it("devuelve null si no está guardado", async () => {
      typeormRepository.findOne.mockResolvedValue(null);

      expect(await repository.buscarPorCodigo("7801234000018")).toBeNull();
    });
  });

  describe("buscarCompatibles", () => {
    it("excluye por alérgenos y trazas del usuario con los índices GIN y pagina", async () => {
      typeormRepository.query
        .mockResolvedValueOnce([{ total: 3 }])
        .mockResolvedValueOnce([]);

      await repository.buscarCompatibles(
        { q: "Galletas de AVENA", limit: 20, offset: 0 },
        [AllergenCode.MANI],
      );

      const [[sqlTotal, paramsTotal], [sqlPagina, paramsPagina]] =
        typeormRepository.query.mock.calls;
      for (const sql of [sqlTotal, sqlPagina]) {
        expect(sql).toContain("NOT (p.alergenos && $2::text[])");
        expect(sql).toContain("NOT (p.trazas && $2::text[])");
      }
      expect(paramsTotal).toEqual([["galleta", "avena"], ["mani"]]);
      expect(sqlPagina).toContain("LIMIT $3 OFFSET $4");
      expect(paramsPagina).toEqual([["galleta", "avena"], ["mani"], 20, 0]);
    });

    it("no consulta la base si la consulta no tiene tokens útiles", async () => {
      const resultado = await repository.buscarCompatibles(
        { q: "de la", limit: 20, offset: 0 },
        [],
      );

      expect(resultado).toEqual({ total: 0, resultados: [] });
      expect(typeormRepository.query).not.toHaveBeenCalled();
    });
  });

  describe("buscarPersonalizadoRespaldo", () => {
    const PARAMS = { q: "Galletas de AVENA", limit: 10, offset: 20 };
    const ALERGIAS = [AllergenCode.LACTEOS, AllergenCode.MANI];

    it("cuenta, agrupa los no aptos por alérgeno y ordena por la regla local", async () => {
      typeormRepository.query
        .mockResolvedValueOnce([{ total_base: 5, no_aptos: 2 }])
        .mockResolvedValueOnce([
          { codigo: "lacteos", cantidad: 2 },
          { codigo: "mani", cantidad: 1 },
        ])
        .mockResolvedValueOnce([filaGuardada("7801234000018", 4)]);

      const resultado = await repository.buscarPersonalizadoRespaldo(
        PARAMS,
        ALERGIAS,
        "filtrar",
      );

      const [
        [sqlConteo, paramsConteo],
        [sqlMotivos],
        [sqlPagina, paramsPagina],
      ] = typeormRepository.query.mock.calls;
      expect(sqlConteo).toContain("FILTER (WHERE p.alergenos && $2::text[])");
      expect(paramsConteo).toEqual([
        ["galleta", "avena"],
        ["lacteos", "mani"],
      ]);
      expect(sqlMotivos).toContain("unnest(x.alergenos)");
      expect(sqlMotivos).toContain("GROUP BY a.codigo");
      expect(sqlPagina).toContain("AND NOT (p.alergenos && $2::text[])");
      expect(sqlPagina).toMatch(/ORDER BY CASE[\s\S]*THEN 2[\s\S]*THEN 1/);
      expect(sqlPagina).toContain("p.trazas && $2::text[]");
      expect(sqlPagina).toContain("p.completitud < 0.5");
      expect(sqlPagina).toContain("LIMIT $3 OFFSET $4");
      expect(paramsPagina).toEqual([
        ["galleta", "avena"],
        ["lacteos", "mani"],
        10,
        20,
      ]);
      expect(resultado).toMatchObject({
        total: 3,
        total_base: 5,
        no_aptos: 2,
        motivos: [
          { codigo: "lacteos", cantidad: 2 },
          { codigo: "mani", cantidad: 1 },
        ],
      });
      expect(resultado.resultados).toEqual([
        expect.objectContaining({ score: 4, posicion: 21 }),
      ]);
      expect(resultado.resultados[0].producto.codigo_barras).toBe(
        "7801234000018",
      );
    });

    it("en reordenar no excluye los no aptos y total cuenta todas las coincidencias", async () => {
      typeormRepository.query
        .mockResolvedValueOnce([{ total_base: 5, no_aptos: 2 }])
        .mockResolvedValueOnce([{ codigo: "lacteos", cantidad: 2 }])
        .mockResolvedValueOnce([]);

      const resultado = await repository.buscarPersonalizadoRespaldo(
        PARAMS,
        ALERGIAS,
        "reordenar",
      );

      const sqlPagina = typeormRepository.query.mock.calls[2][0];
      expect(sqlPagina).not.toContain("AND NOT (p.alergenos");
      expect(resultado.total).toBe(5);
    });

    it("sin no aptos no consulta los motivos", async () => {
      typeormRepository.query
        .mockResolvedValueOnce([{ total_base: 1, no_aptos: 0 }])
        .mockResolvedValueOnce([filaGuardada("7801234000018", 4)]);

      const resultado = await repository.buscarPersonalizadoRespaldo(
        PARAMS,
        ALERGIAS,
        "filtrar",
      );

      expect(typeormRepository.query).toHaveBeenCalledTimes(2);
      expect(resultado.motivos).toEqual([]);
      expect(resultado.total).toBe(1);
    });

    it("sin coincidencias no busca la página", async () => {
      typeormRepository.query.mockResolvedValueOnce([
        { total_base: 0, no_aptos: 0 },
      ]);

      const resultado = await repository.buscarPersonalizadoRespaldo(
        PARAMS,
        ALERGIAS,
        "filtrar",
      );

      expect(typeormRepository.query).toHaveBeenCalledTimes(1);
      expect(resultado).toEqual({
        total: 0,
        total_base: 0,
        no_aptos: 0,
        motivos: [],
        resultados: [],
      });
    });

    it("no consulta la base si la consulta no tiene tokens útiles", async () => {
      const resultado = await repository.buscarPersonalizadoRespaldo(
        { q: "de la", limit: 10, offset: 0 },
        ALERGIAS,
        "filtrar",
      );

      expect(resultado.total_base).toBe(0);
      expect(typeormRepository.query).not.toHaveBeenCalled();
    });
  });
});
