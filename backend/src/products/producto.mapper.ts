import { Producto } from "./contrato/producto";
import { Product } from "./entities/product.entity";

export type FilaProducto = Omit<Product, "creado_en" | "actualizado_en">;

/** Convierte un Producto del contrato en una fila de la tabla products. */
export function aFilaProducto(producto: Producto): FilaProducto {
  const { procedencia, calidad } = producto;
  return {
    codigo_barras: producto.codigo_barras,
    nombre: producto.nombre,
    marca: producto.marca ?? null,
    cantidad: producto.cantidad ?? null,
    ingredientes_texto: producto.ingredientes_texto ?? null,
    ingredientes: producto.ingredientes ?? [],
    alergenos: producto.alergenos ?? [],
    trazas: producto.trazas ?? [],
    etiquetas_dieta: producto.etiquetas_dieta ?? [],
    nutriscore: producto.nutriscore ?? null,
    imagen_url: producto.imagen_url ?? null,
    fuente: procedencia.fuente,
    url_fuente: procedencia.url_fuente,
    recuperado_en: new Date(procedencia.recuperado_en),
    modificado_en_fuente: procedencia.modificado_en_fuente
      ? new Date(procedencia.modificado_en_fuente)
      : null,
    run_id: procedencia.run_id,
    hash_contenido: procedencia.hash_contenido,
    es_valido: calidad.es_valido,
    problemas: calidad.problemas ?? [],
    completitud: calidad.completitud,
  };
}
