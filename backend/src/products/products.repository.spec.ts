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

describe("ProductsRepository", () => {
  let repository: ProductsRepository;
  let qb: Record<string, jest.Mock | string | ((n: string) => string)>;
  let typeormRepository: { createQueryBuilder: jest.Mock; metadata: object };

  beforeEach(async () => {
    qb = { alias: "Product", escape: (nombre: string) => `"${nombre}"` };
    for (const metodo of ["insert", "values", "orUpdate", "updateEntity"]) {
      qb[metodo] = jest.fn().mockReturnValue(qb);
    }
    qb.execute = jest.fn().mockResolvedValue({});

    typeormRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
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
});
