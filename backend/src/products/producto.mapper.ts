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

/** Convierte una fila de la tabla products en un Producto del contrato. */
export function aProducto(fila: FilaProducto): Producto {
  return {
    codigo_barras: fila.codigo_barras,
    nombre: fila.nombre,
    marca: fila.marca,
    cantidad: fila.cantidad,
    ingredientes_texto: fila.ingredientes_texto,
    ingredientes: fila.ingredientes,
    alergenos: fila.alergenos,
    trazas: fila.trazas,
    etiquetas_dieta: fila.etiquetas_dieta,
    nutriscore: fila.nutriscore,
    imagen_url: fila.imagen_url,
    procedencia: {
      fuente: fila.fuente as Producto["procedencia"]["fuente"],
      url_fuente: fila.url_fuente,
      recuperado_en: aIsoUtc(fila.recuperado_en),
      modificado_en_fuente: fila.modificado_en_fuente
        ? aIsoUtc(fila.modificado_en_fuente)
        : null,
      run_id: fila.run_id,
      hash_contenido: fila.hash_contenido,
    },
    calidad: {
      es_valido: fila.es_valido,
      problemas: fila.problemas,
      completitud: fila.completitud,
    },
  };
}

// Formato del contrato: ISO 8601 en UTC con Z y sin milisegundos.
function aIsoUtc(fecha: Date): string {
  return fecha.toISOString().replace(/\.\d{3}Z$/, "Z");
}
