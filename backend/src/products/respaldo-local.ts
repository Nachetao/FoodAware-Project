import { ResultadoBusqueda } from "./contrato/busqueda";
import {
  ModoBusqueda,
  PerfilRestricciones,
  TipoVeredicto,
} from "./contrato/adaptativo";
import { Producto } from "./contrato/producto";
import {
  ConteoMotivoLocal,
  evaluarCompatibilidad,
} from "./compatibilidad-local";

// Búsqueda personalizada y /compatibles de respaldo (cuando el motor no
// responde), sobre las coincidencias guardadas. Usan la misma regla local que
// el veredicto de respaldo (evaluarCompatibilidad), así la lista, los no aptos
// y el veredicto de cada producto nunca se contradicen.

/** Producto guardado que coincide con la consulta, en orden de score. */
export interface Coincidencia {
  producto: Producto;
  score: number;
}

export interface ResultadoRespaldo {
  total: number;
  resultados: ResultadoBusqueda[];
}

/** Búsqueda personalizada desde la base (respaldo del motor adaptativo). */
export interface ResultadoPersonalizadoRespaldo extends ResultadoRespaldo {
  /** Todas las coincidencias, con los no aptos. */
  total_base: number;
  /** Coincidencias no aptas para el perfil. */
  no_aptos: number;
  /** Cuántos no aptos hay por cada motivo; un producto cuenta en todos los suyos. */
  motivos: ConteoMotivoLocal[];
}

interface Pagina {
  limit: number;
  offset: number;
}

// Sin conflictos primero, después con advertencia y al final los no aptos.
const RANGO: Record<TipoVeredicto, number> = {
  apto: 0,
  apto_con_advertencia: 1,
  no_apto: 2,
};

/**
 * Ordena las coincidencias por la regla local y, dentro de cada grupo, por su
 * orden original (score). En modo filtrar no incluye los no aptos: total
 * cuenta lo visible y total_base todas las coincidencias.
 */
export function personalizadoDeRespaldo(
  coincidencias: Coincidencia[],
  perfil: PerfilRestricciones,
  modo: ModoBusqueda,
  pagina: Pagina,
): ResultadoPersonalizadoRespaldo {
  const evaluadas = coincidencias.map((coincidencia, orden) => ({
    ...coincidencia,
    orden,
    evaluacion: evaluarCompatibilidad(coincidencia.producto, perfil),
  }));
  const noAptas = evaluadas.filter((e) => e.evaluacion.veredicto === "no_apto");
  const visibles = (
    modo === "filtrar"
      ? evaluadas.filter((e) => e.evaluacion.veredicto !== "no_apto")
      : evaluadas
  ).sort(
    (a, b) =>
      RANGO[a.evaluacion.veredicto] - RANGO[b.evaluacion.veredicto] ||
      a.orden - b.orden,
  );
  return {
    total: visibles.length,
    total_base: evaluadas.length,
    no_aptos: noAptas.length,
    motivos: contarMotivos(
      noAptas.flatMap((e) => e.evaluacion.motivos_no_apto),
    ),
    resultados: paginar(visibles, pagina),
  };
}

/**
 * Solo los "apto" con el perfil en modo estricto: sin alérgenos ni
 * contradicciones de dieta, sin trazas de lo que el perfil evita, con datos
 * suficientes y con cada dieta declarada en la etiqueta.
 */
export function compatiblesDeRespaldo(
  coincidencias: Coincidencia[],
  perfil: PerfilRestricciones,
  pagina: Pagina,
): ResultadoRespaldo {
  const estricto = { ...perfil, modo_estricto: true };
  const aptas = coincidencias.filter(
    (c) => evaluarCompatibilidad(c.producto, estricto).veredicto === "apto",
  );
  return { total: aptas.length, resultados: paginar(aptas, pagina) };
}

/** posicion es global, como en FastAPI (offset + 1 en adelante). */
function paginar(
  coincidencias: Coincidencia[],
  { limit, offset }: Pagina,
): ResultadoBusqueda[] {
  return coincidencias
    .slice(offset, offset + limit)
    .map(({ producto, score }, i) => ({
      producto,
      score,
      posicion: offset + i + 1,
    }));
}

/** Los más frecuentes primero; a igual cantidad, por tipo y código. */
function contarMotivos(
  motivos: Array<{ tipo: ConteoMotivoLocal["tipo"]; codigo?: string | null }>,
): ConteoMotivoLocal[] {
  const conteos = new Map<string, ConteoMotivoLocal>();
  for (const { tipo, codigo } of motivos) {
    const clave = `${tipo}:${codigo ?? ""}`;
    const actual = conteos.get(clave);
    if (actual) {
      actual.cantidad += 1;
    } else {
      conteos.set(clave, {
        tipo,
        codigo: (codigo ?? null) as ConteoMotivoLocal["codigo"],
        cantidad: 1,
      });
    }
  }
  return [...conteos.values()].sort(
    (a, b) =>
      b.cantidad - a.cantidad ||
      a.tipo.localeCompare(b.tipo) ||
      (a.codigo ?? "").localeCompare(b.codigo ?? ""),
  );
}
