import { etiquetaAlergeno } from './alergenos';

// Traducción de los códigos de calidad.problemas (docs/contratos/README.md,
// sección "Calidad") a texto legible.

const TEXTOS: Record<string, string> = {
  sin_nombre: 'La fuente no informa el nombre del producto.',
  sin_ingredientes: 'La fuente no informa los ingredientes.',
  ingredientes_vacios: 'El texto de ingredientes quedó vacío al limpiarlo.',
  codigo_barras_longitud_invalida:
    'El código de barras no es EAN-8, UPC-A ni EAN-13.',
  codigo_barras_digito_verificador_invalido:
    'El dígito verificador del código de barras no coincide.',
  sin_marca: 'La fuente no informa la marca.',
  sin_cantidad: 'La fuente no informa la cantidad.',
  sin_nutriscore: 'La fuente no informa el Nutri-Score.',
  sin_imagen: 'La fuente no tiene imagen del producto.',
  alergenos_no_reconocidos:
    'Open Food Facts informa alérgenos que no se pudieron reconocer.',
};

const CON_DETALLE: Record<string, (detalle: string) => string> = {
  alergeno_detectado_en_texto: (c) =>
    `${etiquetaAlergeno(c)} detectado en el texto de ingredientes.`,
  traza_detectada_en_texto: (c) =>
    `Trazas de ${etiquetaAlergeno(c).toLowerCase()} detectadas en el texto de ingredientes.`,
  alergeno_posible: (c) =>
    `Posible presencia de ${etiquetaAlergeno(c).toLowerCase()} (indicio sin confirmar, no se marca como alérgeno).`,
  posible_duplicado: (codigo) =>
    `Posible duplicado del producto con código ${codigo}.`,
};

/** Códigos que explican por qué se marcaron (o no) los alérgenos. */
const DE_ALERGENOS = new Set([
  'alergeno_detectado_en_texto',
  'traza_detectada_en_texto',
  'alergeno_posible',
  'alergenos_no_reconocidos',
]);

/** Texto legible de un código de calidad.problemas; un código desconocido se devuelve tal cual. */
export function explicarProblema(problema: string): string {
  const [codigo, detalle] = separar(problema);
  if (detalle !== undefined && CON_DETALLE[codigo]) {
    return CON_DETALLE[codigo](detalle);
  }
  return TEXTOS[codigo] ?? problema;
}

export function esProblemaDeAlergenos(problema: string): boolean {
  return DE_ALERGENOS.has(separar(problema)[0]);
}

function separar(problema: string): [string, string | undefined] {
  const i = problema.indexOf(':');
  return i === -1 ? [problema, undefined] : [problema.slice(0, i), problema.slice(i + 1)];
}
