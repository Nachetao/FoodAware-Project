import { etiquetaAlergeno, etiquetaDieta } from './alergenos';
import { InterpretacionConsulta } from './busqueda-personalizada';
import { Confianza, Veredicto } from './compatibilidad';

// Cómo se muestra el veredicto del motor, igual en el detalle y en la
// búsqueda. Cada estado tiene su propio título, texto corto e ícono, así se
// distingue también sin color.

export interface PresentacionVeredicto {
  /** Título de la franja del detalle. */
  titulo: string;
  /** Texto del chip de cada resultado de la búsqueda. */
  chip: string;
  /** Nombre del ionicon. */
  icono: string;
  /** Clase CSS del estado. */
  clase: string;
}

const PRESENTACION: Record<Veredicto, PresentacionVeredicto> = {
  apto: {
    titulo: 'Apto para ti',
    chip: 'Apto',
    icono: 'checkmark-circle-outline',
    clase: 'apto',
  },
  apto_con_advertencia: {
    titulo: 'Apto con advertencia',
    chip: 'Con advertencia',
    icono: 'warning-outline',
    clase: 'apto-con-advertencia',
  },
  no_apto: {
    titulo: 'No apto para ti',
    chip: 'No apto',
    icono: 'close-circle-outline',
    clase: 'no-apto',
  },
};

// Ante un valor desconocido se muestra como advertencia: nunca como "apto".
export function presentarVeredicto(veredicto: string): PresentacionVeredicto {
  return (
    (PRESENTACION as Record<string, PresentacionVeredicto | undefined>)[veredicto] ??
    PRESENTACION.apto_con_advertencia
  );
}

const CONFIANZA: Record<Confianza, { etiqueta: string; frase: string; nivel: number }> = {
  alta: {
    etiqueta: 'Alta',
    frase: 'Datos completos y declarados por la fuente.',
    nivel: 3,
  },
  media: {
    etiqueta: 'Media',
    frase: 'Parte de la información está incompleta o se dedujo del texto.',
    nivel: 2,
  },
  baja: {
    etiqueta: 'Baja',
    frase: 'Faltan datos o es una revisión básica: revisa la etiqueta.',
    nivel: 1,
  },
};

/** Etiqueta, frase corta y nivel (1 a 3) de la confianza; desconocida = baja. */
export function presentarConfianza(confianza: string): {
  etiqueta: string;
  frase: string;
  nivel: number;
} {
  return (
    (CONFIANZA as Record<string, (typeof CONFIANZA)[Confianza] | undefined>)[confianza] ??
    CONFIANZA.baja
  );
}

/** "a", "a y b", "a, b y c". */
export function enumerar(partes: string[]): string {
  return partes.length > 1
    ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
    : (partes[0] ?? '');
}

/**
 * Cómo se interpretó la consulta, o null si no traía restricciones:
 * «chocolate sin leche» → 'Buscamos «chocolate» sin lácteos (por «sin leche»).'
 */
export function textoInterpretacion(interpretacion: InterpretacionConsulta): string | null {
  const restricciones = interpretacion.restricciones ?? [];
  if (restricciones.length === 0) {
    return null;
  }
  const partes = restricciones.map(({ texto, tipo, codigo }) =>
    tipo === 'dieta'
      ? `compatible con la dieta ${etiquetaDieta(codigo).toLowerCase()} (por «${texto}»)`
      : `sin ${etiquetaAlergeno(codigo).toLowerCase()} (por «${texto}»)`,
  );
  return `Buscamos «${interpretacion.terminos.join(' ')}» ${enumerar(partes)}.`;
}

/** Restricciones de la consulta que no se reconocieron, o null si no hay. */
export function textoNoReconocidas(interpretacion: InterpretacionConsulta): string | null {
  const noReconocidas = interpretacion.no_reconocidas ?? [];
  if (noReconocidas.length === 0) {
    return null;
  }
  const frases = enumerar(noReconocidas.map((texto) => `«${texto}»`));
  return `No reconocimos ${frases} como alérgeno ni dieta: se buscó como texto.`;
}
