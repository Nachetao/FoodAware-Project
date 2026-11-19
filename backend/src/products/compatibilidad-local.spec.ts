import {
  AVISO,
  enumerar,
  evaluarCompatibilidad,
  textoNoAptos,
  veredictoDeRespaldo,
} from "./compatibilidad-local";
import { AllergenCode } from "./contrato/enums";
import { Producto } from "./contrato/producto";

const { LACTEOS, MANI, GLUTEN, SOYA } = AllergenCode;

const galletas = {
  codigo_barras: "7801234000018",
  ingredientes: ["harina de trigo", "leche", "avena"],
  alergenos: [GLUTEN, LACTEOS],
  trazas: [MANI],
  calidad: { es_valido: true, problemas: [], completitud: 0.9 },
} as unknown as Producto;

const con = (cambios: Partial<Producto>) =>
  ({ ...galletas, ...cambios }) as Producto;
const calidad = (completitud: number, problemas: string[] = []) => ({
  es_valido: problemas.length === 0,
  problemas,
  completitud,
});

describe("evaluarCompatibilidad (regla local)", () => {
  it("no_apto si un alérgeno coincide, aunque también haya trazas en conflicto", () => {
    expect(evaluarCompatibilidad(galletas, [LACTEOS, MANI])).toEqual({
      veredicto: "no_apto",
      alergenos_en_conflicto: [LACTEOS],
      trazas_en_conflicto: [MANI],
      datos_suficientes: true,
    });
  });

  it("no_apto por alérgeno aunque los datos sean insuficientes", () => {
    const local = evaluarCompatibilidad(con({ calidad: calidad(0.2) }), [
      LACTEOS,
    ]);

    expect(local.veredicto).toBe("no_apto");
    expect(local.datos_suficientes).toBe(false);
  });

  it("las trazas en conflicto nunca dan apto: apto_con_advertencia", () => {
    expect(evaluarCompatibilidad(galletas, [MANI])).toEqual({
      veredicto: "apto_con_advertencia",
      alergenos_en_conflicto: [],
      trazas_en_conflicto: [MANI],
      datos_suficientes: true,
    });
  });

  it("una traza que ya es ingrediente no se cuenta como traza", () => {
    const local = evaluarCompatibilidad(con({ trazas: [LACTEOS] }), [LACTEOS]);

    expect(local.alergenos_en_conflicto).toEqual([LACTEOS]);
    expect(local.trazas_en_conflicto).toEqual([]);
  });

  it("apto si no hay conflictos y los datos son suficientes", () => {
    expect(evaluarCompatibilidad(galletas, [SOYA]).veredicto).toBe("apto");
  });

  it.each([
    ["sin ingredientes", { ingredientes: [] }],
    [
      "con el problema sin_ingredientes",
      { calidad: calidad(0.9, ["sin_ingredientes"]) },
    ],
    [
      "con el problema ingredientes_vacios",
      { calidad: calidad(0.9, ["ingredientes_vacios"]) },
    ],
    ["con completitud menor que 0,5", { calidad: calidad(0.49) }],
  ])(
    "con alergias y datos insuficientes (%s): apto_con_advertencia",
    (_caso, cambios: Partial<Producto>) => {
      expect(evaluarCompatibilidad(con(cambios), [SOYA])).toEqual({
        veredicto: "apto_con_advertencia",
        alergenos_en_conflicto: [],
        trazas_en_conflicto: [],
        datos_suficientes: false,
      });
    },
  );

  it("con completitud justo 0,5 los datos alcanzan", () => {
    const local = evaluarCompatibilidad(con({ calidad: calidad(0.5) }), [SOYA]);

    expect(local.veredicto).toBe("apto");
    expect(local.datos_suficientes).toBe(true);
  });

  it("sin alergias en el perfil es apto aunque falten datos", () => {
    const local = evaluarCompatibilidad(con({ ingredientes: [] }), []);

    expect(local.veredicto).toBe("apto");
    expect(local.datos_suficientes).toBe(false);
  });
});

describe("veredictoDeRespaldo", () => {
  it("arma un Veredicto completo con confianza baja y el aviso", () => {
    expect(veredictoDeRespaldo(galletas, [LACTEOS, MANI])).toEqual({
      codigo_barras: "7801234000018",
      veredicto: "no_apto",
      alergenos_en_conflicto: [LACTEOS],
      trazas_en_conflicto: [MANI],
      dietas_no_confirmadas: [],
      conflictos: [
        { codigo: LACTEOS, tipo: "alergeno", origen: "fuente" },
        { codigo: MANI, tipo: "traza", origen: "fuente" },
      ],
      motivos_no_apto: [{ tipo: "alergeno", codigo: LACTEOS }],
      datos_suficientes: true,
      explicacion:
        "El servicio de evaluación no está disponible: esta es una revisión básica de tus alergias. Contiene lácteos, que está en tu perfil. Puede contener trazas de maní.",
      confianza: "baja",
      motivos_confianza: ["evaluacion_de_respaldo"],
      aviso: AVISO,
    });
  });

  it("nunca responde apto: sin conflictos baja a apto_con_advertencia", () => {
    const veredicto = veredictoDeRespaldo(galletas, [SOYA]);

    expect(veredicto.veredicto).toBe("apto_con_advertencia");
    expect(veredicto).not.toHaveProperty("apto");
    expect(veredicto.motivos_no_apto).toEqual([]);
    expect(veredicto.explicacion).toContain(
      "No encontramos tus alérgenos, pero sin el servicio de evaluación no podemos confirmarlo.",
    );
  });

  it("con el perfil vacío tampoco responde apto", () => {
    expect(veredictoDeRespaldo(galletas, []).veredicto).toBe(
      "apto_con_advertencia",
    );
  });

  it("trazas en conflicto: apto_con_advertencia sin motivos_no_apto", () => {
    const veredicto = veredictoDeRespaldo(galletas, [MANI]);

    expect(veredicto.veredicto).toBe("apto_con_advertencia");
    expect(veredicto.motivos_no_apto).toEqual([]);
    expect(veredicto.explicacion).toContain("Puede contener trazas de maní.");
  });

  it("lista varios alérgenos en la explicación", () => {
    const veredicto = veredictoDeRespaldo(
      con({ alergenos: [GLUTEN, LACTEOS, SOYA] }),
      [GLUTEN, LACTEOS, SOYA],
    );

    expect(veredicto.explicacion).toContain(
      "Contiene gluten, lácteos y soya, que están en tu perfil.",
    );
    expect(veredicto.motivos_no_apto).toHaveLength(3);
  });

  it("marca el origen texto y lo refleja en motivos_confianza", () => {
    const veredicto = veredictoDeRespaldo(
      con({
        calidad: calidad(0.9, [
          "alergeno_detectado_en_texto:lacteos",
          "traza_detectada_en_texto:mani",
        ]),
      }),
      [LACTEOS, MANI],
    );

    expect(veredicto.conflictos).toEqual([
      { codigo: LACTEOS, tipo: "alergeno", origen: "texto" },
      { codigo: MANI, tipo: "traza", origen: "texto" },
    ]);
    expect(veredicto.motivos_confianza).toContain("conflicto_solo_en_texto");
  });

  it.each([
    [0.3, ["evaluacion_de_respaldo", "completitud_baja"]],
    [0.6, ["evaluacion_de_respaldo", "completitud_media"]],
    [0.8, ["evaluacion_de_respaldo"]],
  ])("con completitud %s, motivos_confianza es %j", (completitud, motivos) => {
    const veredicto = veredictoDeRespaldo(
      con({ calidad: calidad(completitud) }),
      [SOYA],
    );

    expect(veredicto.motivos_confianza).toEqual(motivos);
  });

  it("sin ingredientes lo dice en la explicación y en motivos_confianza", () => {
    const veredicto = veredictoDeRespaldo(con({ ingredientes: [] }), [SOYA]);

    expect(veredicto.datos_suficientes).toBe(false);
    expect(veredicto.motivos_confianza).toContain("sin_ingredientes");
    expect(veredicto.explicacion).toContain(
      "No podemos revisarlo bien: no tiene lista de ingredientes.",
    );
  });

  it("con datos incompletos (pero con ingredientes) lo dice en la explicación", () => {
    const veredicto = veredictoDeRespaldo(con({ calidad: calidad(0.3) }), [
      SOYA,
    ]);

    expect(veredicto.explicacion).toContain(
      "No podemos revisarlo bien: sus datos están incompletos.",
    );
  });
});

describe("textoNoAptos", () => {
  it.each([
    [0, [], true, "No hay productos ocultos."],
    [0, [], false, "No hay productos no aptos."],
    [1, [{ codigo: MANI, cantidad: 1 }], true, "1 oculto por contener maní."],
    [
      25,
      [{ codigo: LACTEOS, cantidad: 25 }],
      true,
      "25 ocultos por contener lácteos.",
    ],
    [
      3,
      [
        { codigo: LACTEOS, cantidad: 2 },
        { codigo: MANI, cantidad: 1 },
      ],
      true,
      "3 ocultos: 2 por contener lácteos y 1 por contener maní.",
    ],
    [
      2,
      [{ codigo: SOYA, cantidad: 2 }],
      false,
      "2 no aptos al final por contener soya.",
    ],
    [
      1,
      [{ codigo: GLUTEN, cantidad: 1 }],
      false,
      "1 no apto al final por contener gluten.",
    ],
  ])(
    "con %i no aptos y %j (ocultos: %s): %s",
    (total, motivos, ocultos, texto) => {
      expect(textoNoAptos(total, motivos, ocultos)).toBe(texto);
    },
  );
});

describe("enumerar", () => {
  it.each([
    [[], ""],
    [["maní"], "maní"],
    [["maní", "soya"], "maní y soya"],
    [["maní", "soya", "lácteos"], "maní, soya y lácteos"],
  ])("%j → %s", (partes, texto) => {
    expect(enumerar(partes)).toBe(texto);
  });
});
