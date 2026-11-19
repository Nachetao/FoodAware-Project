import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  MAX_COINCIDENCIAS_RESPALDO,
  ProductsRepository,
} from "./products.repository";
import { PerfilRestricciones } from "./contrato/adaptativo";
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

  describe("respaldo con la regla local", () => {
    const { LACTEOS, MANI } = AllergenCode;
    const perfil = (
      alergias: AllergenCode[],
      cambios: Partial<PerfilRestricciones> = {},
    ): PerfilRestricciones => ({
      alergias,
      dietas: [],
      modo_estricto: false,
      ...cambios,
    });
    // Filas en orden de score, como las devuelve SQL_COINCIDENCIAS.
    const fila = (
      codigo: string,
      score: number,
      cambios: Partial<ReturnType<typeof filaGuardada>> = {},
    ) => ({ ...filaGuardada(codigo, score), ...cambios });
    const conLeche = fila("7800000000011", 6);
    const conTrazaDeMani = fila("7800000000028", 5, {
      alergenos: [],
      trazas: ["mani"],
    });
    const sinConflictos = fila("7800000000035", 4, { alergenos: [] });
    const sinIngredientes = fila("7800000000042", 3, {
      alergenos: [],
      ingredientes: [],
    });
    const codigos = (r: { resultados: Array<{ producto: Producto }> }) =>
      r.resultados.map((x) => x.producto.codigo_barras);

    it("pide todas las coincidencias por score, con el tope, en una sola consulta", async () => {
      typeormRepository.query.mockResolvedValueOnce([]);

      await repository.buscarCompatibles(
        { q: "Galletas de AVENA", limit: 20, offset: 0 },
        perfil([MANI]),
      );

      const [[sql, params]] = typeormRepository.query.mock.calls;
      expect(sql).toContain(
        "ORDER BY s.score DESC, p.completitud DESC, p.codigo_barras",
      );
      expect(sql).toContain("LIMIT $2");
      expect(params).toEqual([
        ["galleta", "avena"],
        MAX_COINCIDENCIAS_RESPALDO,
      ]);
    });

    it.each(["buscarCompatibles", "buscarPersonalizadoRespaldo"] as const)(
      "%s no consulta la base si la consulta no tiene tokens útiles",
      async (metodo) => {
        const resultado = await repository[metodo](
          { q: "de la", limit: 20, offset: 0 },
          perfil([]),
          "filtrar",
        );

        expect(resultado.total).toBe(0);
        expect(typeormRepository.query).not.toHaveBeenCalled();
      },
    );

    it("avisa en el log si se alcanza el tope de coincidencias", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      typeormRepository.query.mockResolvedValueOnce(
        Array.from({ length: MAX_COINCIDENCIAS_RESPALDO }, (_, i) =>
          fila(String(7800000000000 + i), 1),
        ),
      );

      await repository.buscarCompatibles(
        { q: "galletas", limit: 20, offset: 0 },
        perfil([]),
      );

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("alcanzó el tope"),
      );
      warn.mockRestore();
    });

    describe("buscarCompatibles", () => {
      it("deja solo los apto en modo estricto: sin trazas evitadas ni datos insuficientes", async () => {
        typeormRepository.query.mockResolvedValueOnce([
          conLeche,
          conTrazaDeMani,
          sinConflictos,
          sinIngredientes,
        ]);

        const resultado = await repository.buscarCompatibles(
          { q: "galletas", limit: 20, offset: 0 },
          perfil([MANI]),
        );

        expect(resultado.total).toBe(2);
        expect(codigos(resultado)).toEqual(["7800000000011", "7800000000035"]);
      });

      it("con dietas excluye lo que las contradice o no las declara", async () => {
        const vegano = fila("7800000000059", 2, {
          alergenos: [],
          etiquetas_dieta: ["vegano"],
        });
        typeormRepository.query.mockResolvedValueOnce([
          conLeche,
          sinConflictos,
          vegano,
        ]);

        const resultado = await repository.buscarCompatibles(
          { q: "galletas", limit: 20, offset: 0 },
          perfil([], { dietas: [DietLabel.VEGANO] }),
        );

        expect(codigos(resultado)).toEqual(["7800000000059"]);
      });

      it("pagina sobre los apto con la posición global", async () => {
        typeormRepository.query.mockResolvedValueOnce([
          conLeche,
          sinConflictos,
        ]);

        const resultado = await repository.buscarCompatibles(
          { q: "galletas", limit: 1, offset: 1 },
          perfil([MANI]),
        );

        expect(resultado.total).toBe(2);
        expect(resultado.resultados).toEqual([
          expect.objectContaining({ score: 4, posicion: 2 }),
        ]);
      });
    });

    describe("buscarPersonalizadoRespaldo", () => {
      const filas = [conLeche, conTrazaDeMani, sinConflictos, sinIngredientes];

      it("en reordenar: sin conflictos, con advertencia y no aptos, cada grupo por score", async () => {
        typeormRepository.query.mockResolvedValueOnce(filas);

        const resultado = await repository.buscarPersonalizadoRespaldo(
          { q: "galletas", limit: 10, offset: 0 },
          perfil([LACTEOS, MANI]),
          "reordenar",
        );

        expect(codigos(resultado)).toEqual([
          "7800000000035",
          "7800000000028",
          "7800000000042",
          "7800000000011",
        ]);
        expect(resultado).toMatchObject({
          total: 4,
          total_base: 4,
          no_aptos: 1,
          motivos: [{ tipo: "alergeno", codigo: "lacteos", cantidad: 1 }],
        });
      });

      it("en filtrar oculta los no aptos y pagina con la posición global", async () => {
        typeormRepository.query.mockResolvedValueOnce(filas);

        const resultado = await repository.buscarPersonalizadoRespaldo(
          { q: "galletas", limit: 2, offset: 1 },
          perfil([LACTEOS, MANI]),
          "filtrar",
        );

        expect(resultado.total).toBe(3);
        expect(resultado.total_base).toBe(4);
        expect(resultado.resultados.map((r) => r.posicion)).toEqual([2, 3]);
        expect(codigos(resultado)).toEqual(["7800000000028", "7800000000042"]);
      });

      it("con modo estricto y dietas cuenta cada motivo de los no aptos", async () => {
        typeormRepository.query.mockResolvedValueOnce(filas);

        const resultado = await repository.buscarPersonalizadoRespaldo(
          { q: "galletas", limit: 10, offset: 0 },
          perfil([MANI], { dietas: [DietLabel.VEGANO], modo_estricto: true }),
          "filtrar",
        );

        expect(resultado.no_aptos).toBe(3);
        expect(resultado.motivos).toEqual([
          { tipo: "datos_insuficientes", codigo: null, cantidad: 1 },
          { tipo: "dieta", codigo: "vegano", cantidad: 1 },
          { tipo: "traza", codigo: "mani", cantidad: 1 },
        ]);
        // sinConflictos no declara la dieta vegana: advertencia, no oculto.
        expect(codigos(resultado)).toEqual(["7800000000035"]);
      });
    });
  });
});
