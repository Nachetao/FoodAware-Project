// Normalización de la consulta para la búsqueda de respaldo en la base.
// Es intencionalmente simple: los índices de búsqueda llegan en otra unidad.

const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "con",
  "en",
  "para",
  "por",
  "un",
  "una",
]);

/**
 * Convierte la consulta en tokens: minúsculas, sin tildes, separados por todo
 * lo que no sea letra o número, sin stopwords ni tokens de 1 carácter y con un
 * singular básico ("galletas" → "galleta"). Sin repetidos.
 */
export function tokensRespaldo(consulta: string): string[] {
  // NFD separa cada tilde en una marca diacrítica (\p{M}), que luego se quita.
  const sinTildes = consulta
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const tokens = sinTildes
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(singular);
  return [...new Set(tokens)];
}

function singular(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}
