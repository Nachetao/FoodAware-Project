import {
  Conflicto,
  OrigenConflicto,
  TipoVeredicto,
} from "./contrato/adaptativo";
import { AllergenCode } from "./contrato/enums";
import { Producto } from "./contrato/producto";
import {
  EVALUACION_DE_RESPALDO,
  MotivoConfianzaBackend,
  VeredictoBackend,
} from "./dto/compatibilidad.dto";

// Regla local de compatibilidad: solo se usa como respaldo cuando el motor
// adaptativo de FastAPI no responde. Es más pobre que el motor (no conoce
// dietas, indicios ni el modo estricto), así que nunca responde "apto".

/** Mismo texto que el campo aviso del contrato de FastAPI. */
export const AVISO =
  "Clasificación orientativa según tu perfil y los datos de Open Food Facts. No es una garantía de que el producto sea seguro para ti: revisa siempre la etiqueta del envase.";

// Mismos umbrales que COMPLETITUD_MINIMA y COMPLETITUD_ALTA del motor.
const COMPLETITUD_MINIMA = 0.5;
const COMPLETITUD_ALTA = 0.8;
// Problemas de calidad que indican que no hay ingredientes que revisar.
const PROBLEMAS_SIN_INGREDIENTES = new Set([
  "sin_ingredientes",
  "ingredientes_vacios",
]);

const ETIQUETAS: Record<AllergenCode, string> = {
  [AllergenCode.LACTEOS]: "lácteos",
  [AllergenCode.GLUTEN]: "gluten",
  [AllergenCode.HUEVO]: "huevo",
  [AllergenCode.MANI]: "maní",
  [AllergenCode.FRUTOS_SECOS]: "frutos secos",
  [AllergenCode.SOYA]: "soya",
  [AllergenCode.PESCADO]: "pescado",
  [AllergenCode.CRUSTACEOS]: "crustáceos",
  [AllergenCode.MOLUSCOS]: "moluscos",
  [AllergenCode.SESAMO]: "sésamo",
  [AllergenCode.MOSTAZA]: "mostaza",
  [AllergenCode.APIO]: "apio",
  [AllergenCode.SULFITOS]: "sulfitos",
  [AllergenCode.ALTRAMUCES]: "altramuces",
};

/** Resultado de la regla local, antes de armar el Veredicto. */
export interface EvaluacionLocal {
  veredicto: TipoVeredicto;
  alergenos_en_conflicto: AllergenCode[];
  /** Solo las que no son ya un ingrediente (como en el motor). */
  trazas_en_conflicto: AllergenCode[];
  datos_suficientes: boolean;
}

function sinIngredientes(producto: Producto): boolean {
  return (
    producto.ingredientes.length === 0 ||
    producto.calidad.problemas.some((p) => PROBLEMAS_SIN_INGREDIENTES.has(p))
  );
}

/** false si el producto no tiene ingredientes o su completitud es baja. */
export function tieneDatosSuficientes(producto: Producto): boolean {
  return (
    !sinIngredientes(producto) &&
    producto.calidad.completitud >= COMPLETITUD_MINIMA
  );
}

/**
 * Regla conservadora (filas 1, 3 y 5 del contrato del motor):
 * - no_apto: algún alérgeno del producto está en las alergias del usuario.
 * - apto_con_advertencia: solo coinciden trazas, o el usuario tiene alergias
 *   y los datos no alcanzan para confirmar.
 * - apto: nada de lo anterior.
 */
export function evaluarCompatibilidad(
  producto: Producto,
  alergias: AllergenCode[],
): EvaluacionLocal {
  const delUsuario = new Set(alergias);
  const alergenos_en_conflicto = producto.alergenos.filter((a) =>
    delUsuario.has(a),
  );
  const presentes = new Set(producto.alergenos);
  const trazas_en_conflicto = producto.trazas.filter(
    (a) => delUsuario.has(a) && !presentes.has(a),
  );
  const datos_suficientes = tieneDatosSuficientes(producto);

  let veredicto: TipoVeredicto = "apto";
  if (alergenos_en_conflicto.length > 0) {
    veredicto = "no_apto";
  } else if (
    trazas_en_conflicto.length > 0 ||
    (delUsuario.size > 0 && !datos_suficientes)
  ) {
    veredicto = "apto_con_advertencia";
  }
  return {
    veredicto,
    alergenos_en_conflicto,
    trazas_en_conflicto,
    datos_suficientes,
  };
}

/**
 * Veredicto con la forma del motor, armado con la regla local. Se usa cuando
 * el motor no responde: nunca es "apto" (como máximo apto_con_advertencia),
 * la confianza es siempre baja y la explicación dice que el servicio de
 * evaluación no está disponible.
 */
export function veredictoDeRespaldo(
  producto: Producto,
  alergias: AllergenCode[],
): VeredictoBackend {
  const local = evaluarCompatibilidad(producto, alergias);
  const veredicto: TipoVeredicto =
    local.veredicto === "apto" ? "apto_con_advertencia" : local.veredicto;
  const enTexto = (prefijo: string) =>
    new Set(
      producto.calidad.problemas
        .filter((p) => p.startsWith(`${prefijo}:`))
        .map((p) => p.slice(prefijo.length + 1)),
    );
  const alergenosEnTexto = enTexto("alergeno_detectado_en_texto");
  const trazasEnTexto = enTexto("traza_detectada_en_texto");
  const origen = (
    codigo: AllergenCode,
    textos: Set<string>,
  ): OrigenConflicto => (textos.has(codigo) ? "texto" : "fuente");

  const conflictos: Conflicto[] = [
    ...local.alergenos_en_conflicto.map((codigo) => ({
      codigo,
      tipo: "alergeno" as const,
      origen: origen(codigo, alergenosEnTexto),
    })),
    ...local.trazas_en_conflicto.map((codigo) => ({
      codigo,
      tipo: "traza" as const,
      origen: origen(codigo, trazasEnTexto),
    })),
  ];

  return {
    codigo_barras: producto.codigo_barras,
    veredicto,
    alergenos_en_conflicto: local.alergenos_en_conflicto,
    trazas_en_conflicto: local.trazas_en_conflicto,
    dietas_no_confirmadas: [],
    conflictos,
    motivos_no_apto:
      veredicto === "no_apto"
        ? local.alergenos_en_conflicto.map((codigo) => ({
            tipo: "alergeno" as const,
            codigo,
          }))
        : [],
    datos_suficientes: local.datos_suficientes,
    explicacion: explicacionDeRespaldo(producto, local),
    confianza: "baja",
    motivos_confianza: motivosConfianza(producto, conflictos),
    aviso: AVISO,
  };
}

function motivosConfianza(
  producto: Producto,
  conflictos: Conflicto[],
): MotivoConfianzaBackend[] {
  const motivos: MotivoConfianzaBackend[] = [EVALUACION_DE_RESPALDO];
  const { completitud } = producto.calidad;
  if (completitud < COMPLETITUD_MINIMA) {
    motivos.push("completitud_baja");
  } else if (completitud < COMPLETITUD_ALTA) {
    motivos.push("completitud_media");
  }
  if (sinIngredientes(producto)) {
    motivos.push("sin_ingredientes");
  }
  if (conflictos.some((c) => c.origen === "texto")) {
    motivos.push("conflicto_solo_en_texto");
  }
  return motivos;
}

function explicacionDeRespaldo(
  producto: Producto,
  local: EvaluacionLocal,
): string {
  const frases = [
    "El servicio de evaluación no está disponible: esta es una revisión básica de tus alergias.",
  ];
  const { alergenos_en_conflicto: alergenos, trazas_en_conflicto: trazas } =
    local;
  if (alergenos.length > 0) {
    frases.push(
      `Contiene ${lista(alergenos)}, que ${alergenos.length > 1 ? "están" : "está"} en tu perfil.`,
    );
  }
  if (trazas.length > 0) {
    frases.push(`Puede contener trazas de ${lista(trazas)}.`);
  }
  if (!local.datos_suficientes) {
    frases.push(
      sinIngredientes(producto)
        ? "No podemos revisarlo bien: no tiene lista de ingredientes."
        : "No podemos revisarlo bien: sus datos están incompletos.",
    );
  }
  if (alergenos.length === 0 && trazas.length === 0) {
    frases.push(
      "No encontramos tus alérgenos, pero sin el servicio de evaluación no podemos confirmarlo.",
    );
  }
  return frases.join(" ");
}

/** "maní", "maní y lácteos", "maní, soya y lácteos". */
export function enumerar(partes: string[]): string {
  return partes.length > 1
    ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`
    : (partes[0] ?? "");
}

function lista(codigos: AllergenCode[]): string {
  return enumerar(codigos.map((c) => ETIQUETAS[c]));
}

/** Cuántos productos no aptos hay por cada alérgeno del usuario. */
export interface ConteoAlergeno {
  codigo: AllergenCode;
  cantidad: number;
}

/**
 * Resumen de los no aptos de la búsqueda personalizada de respaldo, con el
 * mismo estilo que el texto del motor: "25 ocultos por contener lácteos." o
 * "3 ocultos: 2 por contener lácteos y 1 por contener maní.". Un producto con
 * dos alérgenos cuenta en los dos.
 */
export function textoNoAptos(
  total: number,
  motivos: ConteoAlergeno[],
  ocultos: boolean,
): string {
  if (total === 0) {
    return ocultos ? "No hay productos ocultos." : "No hay productos no aptos.";
  }
  const cuantos = ocultos
    ? `${total} ${total === 1 ? "oculto" : "ocultos"}`
    : `${total} ${total === 1 ? "no apto" : "no aptos"} al final`;
  if (motivos.length === 1) {
    return `${cuantos} por contener ${ETIQUETAS[motivos[0].codigo]}.`;
  }
  const partes = motivos.map(
    (m) => `${m.cantidad} por contener ${ETIQUETAS[m.codigo]}`,
  );
  return `${cuantos}: ${enumerar(partes)}.`;
}
