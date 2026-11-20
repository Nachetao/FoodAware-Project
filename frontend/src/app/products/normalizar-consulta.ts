/**
 * Texto de búsqueda tal como se pide al backend: sin espacios al inicio ni al
 * final, con los espacios repetidos (también tabs y saltos de línea) reducidos
 * a uno y en minúsculas.
 *
 * El service worker guarda las búsquedas públicas por URL, así que "Leche",
 * "leche" y " leche  " tienen que producir la misma URL para que una búsqueda
 * hecha con conexión se encuentre sin conexión. No cambia los resultados: el
 * buscador (BM25 y respaldo) y el motor adaptativo ya ignoran las mayúsculas.
 * Las tildes y la puntuación se conservan.
 *
 * Es solo para la petición: lo que el usuario escribió se muestra tal cual.
 */
export function normalizarConsulta(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ').toLowerCase();
}
