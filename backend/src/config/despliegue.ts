// Configuración que depende del entorno de despliegue (local o Render).

/** Orígenes de desarrollo: ng serve (4200) e ionic serve (8100). */
export const ORIGENES_DESARROLLO = [
  "http://localhost:4200",
  "http://localhost:8100",
];

/**
 * Orígenes permitidos por CORS desde CORS_ORIGINS (separados por comas).
 * Si no está definida o queda vacía, se usan los de desarrollo.
 */
export function origenesCors(valor: string | undefined): string[] {
  const origenes = (valor ?? "")
    .split(",")
    .map((origen) => origen.trim().replace(/\/+$/, ""))
    .filter((origen) => origen.length > 0);
  return origenes.length > 0 ? origenes : ORIGENES_DESARROLLO;
}

/** Puerto HTTP: Render lo entrega en PORT. */
export function puerto(valor: string | undefined): number {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : 3000;
}
