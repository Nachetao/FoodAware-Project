export const HEADER_REQUEST_ID = "X-Request-ID";

// Mismo formato que acepta FastAPI para reutilizar un ID entrante.
export const FORMATO_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
