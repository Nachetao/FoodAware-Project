// Formatos en español de Chile para el panel de métricas.

const DECIMAL = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const ENTERO = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const FECHA = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** 87.5 → "87,5 %" (el valor ya viene de 0 a 100). */
export function porcentaje(valor: number): string {
  return `${DECIMAL.format(valor)} %`;
}

/** 0.51 → "51 %" (el valor viene de 0 a 1). */
export function proporcion(valor: number): string {
  return porcentaje(valor * 100);
}

/** 1240 → "1.240". */
export function entero(valor: number): string {
  return ENTERO.format(valor);
}

export function decimal(valor: number): string {
  return DECIMAL.format(valor);
}

/** ISO 8601 → fecha y hora locales. */
export function fecha(iso: string): string {
  return FECHA.format(new Date(iso));
}

/** 150000 → "2 min 30 s"; menos de un segundo → "850 ms". */
export function duracion(ms: number): string {
  if (ms < 1000) {
    return `${entero(ms)} ms`;
  }
  const segundosTotales = Math.round(ms / 1000);
  const minutos = Math.floor(segundosTotales / 60);
  const segundos = segundosTotales % 60;
  if (minutos === 0) {
    return `${segundos} s`;
  }
  return segundos === 0 ? `${minutos} min` : `${minutos} min ${segundos} s`;
}
