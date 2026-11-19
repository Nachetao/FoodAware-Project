import {
  Conflicto,
  MotivoNoApto,
  OrigenConflicto,
  PerfilRestricciones,
  TipoMotivoNoApto,
  TipoVeredicto,
} from "./contrato/adaptativo";
import { AllergenCode, DietLabel } from "./contrato/enums";
import { Producto } from "./contrato/producto";
import {
  EVALUACION_DE_RESPALDO,
  MotivoConfianzaBackend,
  VeredictoBackend,
} from "./dto/compatibilidad.dto";

// Regla local de compatibilidad: solo se usa como respaldo cuando el motor
// adaptativo de FastAPI no responde. Sigue la tabla de veredictos del
// contrato del motor (alergias, dietas, trazas, datos insuficientes y modo
// estricto) salvo los indicios (alérgenos posibles), que no conoce; por eso el
// veredicto de respaldo nunca es "apto".

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

/**
 * Alérgenos que contradicen cada dieta, y que por esa dieta se evitan como
 * traza (misma tabla que el contrato del motor). sin_lactosa no tiene: un
 * deslactosado lleva lácteos y cumple la dieta, así que solo se confirma con
 * la etiqueta.
 */
export const ALERGENOS_POR_DIETA: Record<DietLabel, AllergenCode[]> = {
  [DietLabel.VEGANO]: [
    AllergenCode.LACTEOS,
    AllergenCode.HUEVO,
    AllergenCode.PESCADO,
    AllergenCode.CRUSTACEOS,
    AllergenCode.MOLUSCOS,
  ],
  [DietLabel.VEGETARIANO]: [
    AllergenCode.PESCADO,
    AllergenCode.CRUSTACEOS,
    AllergenCode.MOLUSCOS,
  ],
  [DietLabel.SIN_GLUTEN]: [AllergenCode.GLUTEN],
  [DietLabel.SIN_LACTOSA]: [],
};

/** Nombre de la dieta en "la dieta vegana", "la dieta sin gluten". */
const NOMBRES_DIETA: Record<DietLabel, string> = {
  [DietLabel.VEGANO]: "vegana",
  [DietLabel.VEGETARIANO]: "vegetariana",
  [DietLabel.SIN_GLUTEN]: "sin gluten",
  [DietLabel.SIN_LACTOSA]: "sin lactosa",
};

/** Dieta del perfil que el producto contradice, con los alérgenos que lo hacen. */
export interface DietaContradicha {
  dieta: DietLabel;
  alergenos: AllergenCode[];
}

/** Resultado de la regla local, antes de armar el Veredicto. */
export interface EvaluacionLocal {
  veredicto: TipoVeredicto;
  /** Alergias del perfil que el producto tiene como ingrediente. */
  alergenos_en_conflicto: AllergenCode[];
  dietas_contradichas: DietaContradicha[];
  /**
   * Lo que el perfil evita (por alergia o dieta) como traza; solo las que no
   * son ya un ingrediente (como en el motor).
   */
  trazas_en_conflicto: AllergenCode[];
  /** Dietas que el producto no contradice pero tampoco declara cumplir. */
  dietas_no_confirmadas: DietLabel[];
  datos_suficientes: boolean;
  /** Qué lo hizo no_apto; vacío en los demás veredictos. */
  motivos_no_apto: MotivoNoApto[];
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

/** true si el perfil tiene algo que revisar (alergias o dietas). */
function conRestricciones(perfil: PerfilRestricciones): boolean {
  return perfil.alergias.length > 0 || perfil.dietas.length > 0;
}

/**
 * Tabla de veredictos del contrato del motor (sin la fila 4, los indicios):
 * 1. Un alérgeno del perfil es ingrediente: no_apto.
 * 2. Un ingrediente contradice una dieta del perfil: no_apto.
 * 3. Algo que el perfil evita es traza: apto_con_advertencia (estricto: no_apto).
 * 5. Con alergias o dietas, datos insuficientes: apto_con_advertencia
 *    (estricto: no_apto).
 * 6. Una dieta que el producto no declara: apto_con_advertencia (también en
 *    modo estricto).
 * 7. Nada de lo anterior: apto.
 */
export function evaluarCompatibilidad(
  producto: Producto,
  perfil: PerfilRestricciones,
): EvaluacionLocal {
  const alergias = new Set(perfil.alergias);
  const presentes = new Set(producto.alergenos);
  const alergenos_en_conflicto = producto.alergenos.filter((a) =>
    alergias.has(a),
  );
  const dietas_contradichas = perfil.dietas
    .map((dieta) => ({
      dieta,
      alergenos: ALERGENOS_POR_DIETA[dieta].filter((a) => presentes.has(a)),
    }))
    .filter((d) => d.alergenos.length > 0);
  const evitados = new Set([
    ...perfil.alergias,
    ...perfil.dietas.flatMap((d) => ALERGENOS_POR_DIETA[d]),
  ]);
  const trazas_en_conflicto = producto.trazas.filter(
    (a) => evitados.has(a) && !presentes.has(a),
  );
  const contradichas = new Set(dietas_contradichas.map((d) => d.dieta));
  const declaradas = new Set<string>(producto.etiquetas_dieta);
  const dietas_no_confirmadas = perfil.dietas.filter(
    (d) => !contradichas.has(d) && !declaradas.has(d),
  );
  const datos_suficientes = tieneDatosSuficientes(producto);
  const faltanDatos = conRestricciones(perfil) && !datos_suficientes;

  const motivos: MotivoNoApto[] = [
    ...alergenos_en_conflicto.map((codigo) => ({
      tipo: "alergeno" as const,
      codigo,
    })),
    ...dietas_contradichas.map(({ dieta }) => ({
      tipo: "dieta" as const,
      codigo: dieta,
    })),
  ];
  if (perfil.modo_estricto) {
    motivos.push(
      ...trazas_en_conflicto.map((codigo) => ({
        tipo: "traza" as const,
        codigo,
      })),
    );
    if (faltanDatos) {
      motivos.push({ tipo: "datos_insuficientes", codigo: null });
    }
  }

  let veredicto: TipoVeredicto = "apto";
  if (motivos.length > 0) {
    veredicto = "no_apto";
  } else if (
    trazas_en_conflicto.length > 0 ||
    faltanDatos ||
    dietas_no_confirmadas.length > 0
  ) {
    veredicto = "apto_con_advertencia";
  }
  return {
    veredicto,
    alergenos_en_conflicto,
    dietas_contradichas,
    trazas_en_conflicto,
    dietas_no_confirmadas,
    datos_suficientes,
    motivos_no_apto: veredicto === "no_apto" ? motivos : [],
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
  perfil: PerfilRestricciones,
): VeredictoBackend {
  const local = evaluarCompatibilidad(producto, perfil);
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
    // Si todos los ingredientes que la contradicen salen solo del texto, el
    // conflicto de dieta también.
    ...local.dietas_contradichas.map(({ dieta, alergenos }) => ({
      codigo: dieta,
      tipo: "dieta" as const,
      origen: alergenos.every((a) => alergenosEnTexto.has(a))
        ? ("texto" as const)
        : ("fuente" as const),
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
    dietas_no_confirmadas: local.dietas_no_confirmadas,
    conflictos,
    motivos_no_apto: local.motivos_no_apto,
    datos_suficientes: local.datos_suficientes,
    explicacion: explicacionDeRespaldo(producto, local, perfil),
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
  perfil: PerfilRestricciones,
): string {
  const conDietas = perfil.dietas.length > 0;
  const frases = [
    `El servicio de evaluación no está disponible: esta es una revisión básica de tus ${conDietas ? "alergias y dietas" : "alergias"}.`,
  ];
  const {
    alergenos_en_conflicto: alergenos,
    dietas_contradichas: contradichas,
    trazas_en_conflicto: trazas,
    dietas_no_confirmadas: noConfirmadas,
  } = local;
  if (alergenos.length > 0) {
    frases.push(
      `Contiene ${lista(alergenos)}, que ${alergenos.length > 1 ? "están" : "está"} en tu perfil.`,
    );
  }
  for (const { dieta, alergenos: contradicen } of contradichas) {
    frases.push(
      `No cumple la dieta ${NOMBRES_DIETA[dieta]}: contiene ${lista(contradicen)}.`,
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
  if (noConfirmadas.length > 0) {
    const nombres = enumerar(noConfirmadas.map((d) => NOMBRES_DIETA[d]));
    frases.push(
      noConfirmadas.length > 1
        ? `No indica que cumpla las dietas ${nombres}.`
        : `No indica que cumpla la dieta ${nombres}.`,
    );
  }
  // No apto solo por el modo estricto (trazas o datos insuficientes).
  if (
    local.veredicto === "no_apto" &&
    alergenos.length === 0 &&
    contradichas.length === 0
  ) {
    frases.push("Con el modo estricto, esto lo hace no apto.");
  }
  if (
    alergenos.length === 0 &&
    contradichas.length === 0 &&
    trazas.length === 0
  ) {
    frases.push(
      conDietas
        ? "No encontramos nada que tu perfil evite, pero sin el servicio de evaluación no podemos confirmarlo."
        : "No encontramos tus alérgenos, pero sin el servicio de evaluación no podemos confirmarlo.",
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

/** Cuántos productos no aptos hay por cada motivo (alérgeno, dieta, traza...). */
export interface ConteoMotivoLocal {
  tipo: TipoMotivoNoApto;
  /** Alérgeno o dieta; null solo en datos_insuficientes. */
  codigo: AllergenCode | DietLabel | null;
  cantidad: number;
}

/** "por contener lácteos", "por no cumplir la dieta vegana"... */
function fraseMotivo({ tipo, codigo }: ConteoMotivoLocal): string {
  switch (tipo) {
    case "alergeno":
      return `por contener ${ETIQUETAS[codigo as AllergenCode]}`;
    case "traza":
    case "posible":
      return `por poder contener ${ETIQUETAS[codigo as AllergenCode]}`;
    case "dieta":
      return `por no cumplir la dieta ${NOMBRES_DIETA[codigo as DietLabel]}`;
    case "datos_insuficientes":
      return "por falta de datos";
  }
}

/**
 * Resumen de los no aptos de la búsqueda personalizada de respaldo, con el
 * mismo estilo que el texto del motor: "25 ocultos por contener lácteos." o
 * "3 ocultos: 2 por contener lácteos y 1 por poder contener maní.". Un
 * producto con dos motivos cuenta en los dos.
 */
export function textoNoAptos(
  total: number,
  motivos: ConteoMotivoLocal[],
  ocultos: boolean,
): string {
  if (total === 0) {
    return ocultos ? "No hay productos ocultos." : "No hay productos no aptos.";
  }
  const cuantos = ocultos
    ? `${total} ${total === 1 ? "oculto" : "ocultos"}`
    : `${total} ${total === 1 ? "no apto" : "no aptos"} al final`;
  if (motivos.length === 1) {
    return `${cuantos} ${fraseMotivo(motivos[0])}.`;
  }
  const partes = motivos.map((m) => `${m.cantidad} ${fraseMotivo(m)}`);
  return `${cuantos}: ${enumerar(partes)}.`;
}
