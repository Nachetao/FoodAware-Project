import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ParametrosBusqueda, ResultadoBusqueda } from "./contrato/busqueda";
import { Producto } from "./contrato/producto";
import { AllergenCode } from "./contrato/enums";
import { Product } from "./entities/product.entity";
import { tokensRespaldo } from "./busqueda-respaldo";
import { aFilaProducto, aProducto, FilaProducto } from "./producto.mapper";
import { ModoBusqueda } from "./contrato/adaptativo";
import { ConteoAlergeno } from "./compatibilidad-local";

export interface ResultadoRespaldo {
  total: number;
  resultados: ResultadoBusqueda[];
}

/** Búsqueda personalizada desde la base (respaldo del motor adaptativo). */
export interface ResultadoPersonalizadoRespaldo extends ResultadoRespaldo {
  /** Todas las coincidencias, con los no aptos. */
  total_base: number;
  /** Coincidencias con algún alérgeno del usuario como ingrediente. */
  no_aptos: number;
  /** Cuántos no aptos hay por cada alérgeno del usuario. */
  motivos: ConteoAlergeno[];
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

// Compatibles: además, ningún alérgeno del usuario ($2), ni como ingrediente
// ni como traza: "solo aptos" no muestra productos con advertencia. Usa los
// índices GIN IDX_products_alergenos_gin e IDX_products_trazas_gin; con
// $2 = '{}' no excluye nada.
const SIN_ALERGIAS_DEL_USUARIO = `AND NOT (p.alergenos && $2::text[])
  AND NOT (p.trazas && $2::text[])`;
const SQL_TOTAL_COMPATIBLES = `${SQL_TOTAL} ${SIN_ALERGIAS_DEL_USUARIO}`;
const SQL_PAGINA_COMPATIBLES = `SELECT p.*, s.score ${DESDE_PUNTUADOS}
  ${SIN_ALERGIAS_DEL_USUARIO}
  ORDER BY s.score DESC, p.completitud DESC, p.codigo_barras
  LIMIT $3 OFFSET $4`;

// Personalizada de respaldo: misma regla local que compatibilidad-local.ts,
// en SQL para ordenar y paginar en la base. Con las alergias del usuario ($2):
// 0 sin conflictos, 1 con advertencia (traza, sin ingredientes o completitud
// menor que 0,5) y 2 no apto (alérgeno como ingrediente).
const NO_APTO = `p.alergenos && $2::text[]`;
const RANGO_LOCAL = `CASE
    WHEN ${NO_APTO} THEN 2
    WHEN cardinality($2::text[]) > 0 AND (p.trazas && $2::text[]
      OR cardinality(p.ingredientes) = 0 OR p.completitud < 0.5) THEN 1
    ELSE 0
  END`;
const SQL_CONTEO_PERSONALIZADA = `SELECT count(*)::int AS total_base,
    (count(*) FILTER (WHERE ${NO_APTO}))::int AS no_aptos
  ${DESDE_PUNTUADOS}`;
// Un producto con dos alérgenos del usuario cuenta en los dos.
const SQL_MOTIVOS_NO_APTOS = `SELECT a.codigo, count(*)::int AS cantidad
  FROM (SELECT p.alergenos ${DESDE_PUNTUADOS} AND ${NO_APTO}) x
  CROSS JOIN LATERAL unnest(x.alergenos) AS a(codigo)
  WHERE a.codigo = ANY($2::text[])
  GROUP BY a.codigo
  ORDER BY cantidad DESC, a.codigo`;
const sqlPaginaPersonalizada = (modo: ModoBusqueda) =>
  `SELECT p.*, s.score ${DESDE_PUNTUADOS}
  ${modo === "filtrar" ? `AND NOT (${NO_APTO})` : ""}
  ORDER BY ${RANGO_LOCAL}, s.score DESC, p.completitud DESC, p.codigo_barras
  LIMIT $3 OFFSET $4`;

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

  /**
   * Productos guardados que coinciden con la búsqueda (mismo score que el
   * respaldo) y no contienen ninguno de los alérgenos indicados.
   */
  async buscarCompatibles(
    { q, limit, offset }: ParametrosBusqueda,
    alergias: AllergenCode[],
  ): Promise<ResultadoRespaldo> {
    const tokens = tokensRespaldo(q);
    if (tokens.length === 0) {
      return { total: 0, resultados: [] };
    }

    const [{ total }] = await this.repository.query(SQL_TOTAL_COMPATIBLES, [
      tokens,
      alergias,
    ]);
    if (total === 0) {
      return { total: 0, resultados: [] };
    }

    const filas: Array<FilaProducto & { score: number }> =
      await this.repository.query(SQL_PAGINA_COMPATIBLES, [
        tokens,
        alergias,
        limit,
        offset,
      ]);
    return {
      total,
      resultados: filas.map((fila, i) => ({
        producto: aProducto(fila),
        score: fila.score,
        posicion: offset + i + 1,
      })),
    };
  }

  /**
   * Respaldo de la búsqueda personalizada: mismas coincidencias que
   * buscarRespaldo, ordenadas por la regla local (sin conflictos, con
   * advertencia y no aptos) y luego por score. En modo filtrar no incluye los
   * no aptos; total cuenta lo visible y total_base todas las coincidencias.
   */
  async buscarPersonalizadoRespaldo(
    { q, limit, offset }: ParametrosBusqueda,
    alergias: AllergenCode[],
    modo: ModoBusqueda,
  ): Promise<ResultadoPersonalizadoRespaldo> {
    const vacio = { total: 0, total_base: 0, no_aptos: 0, motivos: [] };
    const tokens = tokensRespaldo(q);
    if (tokens.length === 0) {
      return { ...vacio, resultados: [] };
    }

    const [{ total_base, no_aptos }] = await this.repository.query(
      SQL_CONTEO_PERSONALIZADA,
      [tokens, alergias],
    );
    if (total_base === 0) {
      return { ...vacio, resultados: [] };
    }

    const [motivos, filas]: [
      ConteoAlergeno[],
      Array<FilaProducto & { score: number }>,
    ] = await Promise.all([
      no_aptos > 0
        ? this.repository.query(SQL_MOTIVOS_NO_APTOS, [tokens, alergias])
        : Promise.resolve([]),
      this.repository.query(sqlPaginaPersonalizada(modo), [
        tokens,
        alergias,
        limit,
        offset,
      ]),
    ]);
    return {
      total: modo === "filtrar" ? total_base - no_aptos : total_base,
      total_base,
      no_aptos,
      motivos,
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
