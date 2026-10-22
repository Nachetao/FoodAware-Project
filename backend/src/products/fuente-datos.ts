/**
 * Header de GET /api/products/search que indica de dónde vienen los datos:
 * "fastapi" (búsqueda normal) o "respaldo" (FastAPI falló y se respondió
 * desde la tabla products). En el respaldo, estado_fuente también es "cache".
 */
export const HEADER_FUENTE_DATOS = "X-Fuente-Datos";

export type FuenteDatos = "fastapi" | "respaldo";
