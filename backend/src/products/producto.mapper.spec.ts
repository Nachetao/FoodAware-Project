import { aFilaProducto, aProducto } from "./producto.mapper";
import { Producto } from "./contrato/producto";
import { AllergenCode, DietLabel } from "./contrato/enums";

const producto: Producto = {
  codigo_barras: "7801234000018",
  nombre: "Leche semidescremada",
  marca: "Colun",
  cantidad: "1 L",
  ingredientes_texto: "Leche, vitaminas A, D3.",
  ingredientes: ["leche", "vitaminas A, D3"],
  alergenos: [AllergenCode.LACTEOS],
  trazas: [AllergenCode.FRUTOS_SECOS],
  etiquetas_dieta: [DietLabel.VEGETARIANO],
  nutriscore: "b",
  imagen_url: "https://images.openfoodfacts.org/leche.jpg",
  procedencia: {
    fuente: "openfoodfacts",
    url_fuente: "https://world.openfoodfacts.org/product/7801234000018",
    recuperado_en: "2026-10-20T14:30:00Z",
    modificado_en_fuente: "2026-09-02T08:15:00Z",
    run_id: "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b",
    hash_contenido: "a".repeat(64),
  },
  calidad: { es_valido: true, problemas: ["sin_imagen"], completitud: 0.9 },
};

describe("producto.mapper", () => {
  it("aProducto deshace aFilaProducto", () => {
    expect(aProducto(aFilaProducto(producto))).toEqual(producto);
  });

  it("aProducto devuelve las fechas en ISO 8601 UTC con Z y sin milisegundos", () => {
    const fila = {
      ...aFilaProducto(producto),
      recuperado_en: new Date("2026-10-20T14:30:00.123Z"),
      modificado_en_fuente: null,
    };

    const { procedencia } = aProducto(fila);

    expect(procedencia.recuperado_en).toBe("2026-10-20T14:30:00Z");
    expect(procedencia.modificado_en_fuente).toBeNull();
  });
});
