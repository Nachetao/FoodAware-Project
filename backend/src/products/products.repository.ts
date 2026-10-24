import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ParametrosBusqueda, ResultadoBusqueda } from "./contrato/busqueda";
import { Producto } from "./contrato/producto";
import { Product } from "./entities/product.entity";
import { tokensRespaldo } from "./busqueda-respaldo";
import { aFilaProducto, aProducto, FilaProducto } from "./producto.mapper";

export interface ResultadoRespaldo {
  total: number;
  resultados: ResultadoBusqueda[];
}

// Normalización de los campos en SQL, sin la extensión unaccent.
const CON_TILDE = "áéíóúüñàèìòù";
const SIN_TILDE = "aeiouunaeiou";
const normalizar = (campo: string) =>
  `translate(lower(${campo}), '${CON_TILDE}', '${SIN_TILDE}')`;

// Score: por cada token ($1), 3 si está en el nombre, 2 en la marca y 1 en
// los ingredientes (mismos pesos por campo que FastAPI). Coincide por inicio
// de palabra (\m): "galleta" encuentra "galletas", "pan" no encuentra "empanada".
// Solo productos válidos, igual que el índice de FastAPI.
const DESDE_PUNTUADOS = `
  FROM products p
  CROSS JOIN LATERAL (
    SELECT ${normalizar("p.nombre")} AS nombre,
           ${normalizar("coalesce(p.marca, '')")} AS marca,
           ${normalizar("array_to_string(p.ingredientes, ' ')")} AS ingredientes
  ) n
  CROSS JOIN LATERAL (
    SELECT sum(
        CASE WHEN n.nombre ~ ('\\m' || t.token) THEN 3 ELSE 0 END
      + CASE WHEN n.marca ~ ('\\m' || t.token) THEN 2 ELSE 0 END
      + CASE WHEN n.ingredientes ~ ('\\m' || t.token) THEN 1 ELSE 0 END
    )::int AS score
    FROM unnest($1::text[]) AS t(token)
  ) s
  WHERE p.es_valido AND s.score > 0`;

const SQL_TOTAL = `SELECT count(*)::int AS total ${DESDE_PUNTUADOS}`;
// Mismo desempate que FastAPI: completitud y luego código de barras.
const SQL_PAGINA = `SELECT p.*, s.score ${DESDE_PUNTUADOS}
  ORDER BY s.score DESC, p.completitud DESC, p.codigo_barras
  LIMIT $2 OFFSET $3`;

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
  ) {}

  /**
   * Inserta o actualiza los productos por codigo_barras en un solo INSERT.
   * Una fila existente solo se actualiza si el dato entrante no es más
   * antiguo (recuperado_en), para no pisar datos nuevos con datos en caché.
   */
  async guardar(productos: Producto[]): Promise<void> {
    const filas = this.sinRepetidos(productos.map(aFilaProducto));
    if (filas.length === 0) {
      return;
    }

    const qb = this.repository.createQueryBuilder().insert().values(filas);
    const tabla = qb.escape(qb.alias);
    // actualizado_en no va en la lista: TypeORM lo actualiza solo (= DEFAULT).
    const columnas = this.repository.metadata.columns
      .filter((c) => !c.isPrimary && !c.isCreateDate && !c.isUpdateDate)
      .map((c) => c.databaseName);

    await qb
      .orUpdate(columnas, ["codigo_barras"], {
        overwriteCondition: {
          where: `EXCLUDED."recuperado_en" >= ${tabla}."recuperado_en"`,
        },
      })
      .updateEntity(false)
      .execute();
  }

  /**
   * Búsqueda de respaldo por texto en nombre, marca e ingredientes, para
   * cuando FastAPI no responde. Devuelve los resultados con la forma del
   * contrato; posicion es global, como en FastAPI (offset + 1 en adelante).
   */
  async buscarRespaldo({
    q,
    limit,
    offset,
  }: ParametrosBusqueda): Promise<ResultadoRespaldo> {
    const tokens = tokensRespaldo(q);
    if (tokens.length === 0) {
      return { total: 0, resultados: [] };
    }

    const [{ total }] = await this.repository.query(SQL_TOTAL, [tokens]);
    if (total === 0) {
      return { total: 0, resultados: [] };
    }

    const filas: Array<FilaProducto & { score: number }> =
      await this.repository.query(SQL_PAGINA, [tokens, limit, offset]);
    return {
      total,
      resultados: filas.map((fila, i) => ({
        producto: aProducto(fila),
        score: fila.score,
        posicion: offset + i + 1,
      })),
    };
  }

  /** Producto guardado con ese código, o null; respaldo del detalle de producto. */
  async buscarPorCodigo(codigoBarras: string): Promise<Producto | null> {
    const fila = await this.repository.findOne({
      where: { codigo_barras: codigoBarras },
    });
    return fila ? aProducto(fila) : null;
  }

  // Postgres rechaza un ON CONFLICT DO UPDATE que toca la misma fila dos veces
  // en un INSERT; si un código se repite, se queda el dato más reciente.
  private sinRepetidos(filas: FilaProducto[]): FilaProducto[] {
    const porCodigo = new Map<string, FilaProducto>();
    for (const fila of filas) {
      const actual = porCodigo.get(fila.codigo_barras);
      if (!actual || fila.recuperado_en >= actual.recuperado_en) {
        porCodigo.set(fila.codigo_barras, fila);
      }
    }
    return [...porCodigo.values()];
  }
}
