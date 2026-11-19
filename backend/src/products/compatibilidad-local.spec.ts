import {
  AVISO,
  enumerar,
  evaluarCompatibilidad,
  textoNoAptos,
  veredictoDeRespaldo,
} from "./compatibilidad-local";
import { PerfilRestricciones } from "./contrato/adaptativo";
import { AllergenCode, DietLabel } from "./contrato/enums";
import { Producto } from "./contrato/producto";

const { LACTEOS, MANI, GLUTEN, SOYA, PESCADO } = AllergenCode;
const { VEGANO, VEGETARIANO, SIN_GLUTEN, SIN_LACTOSA } = DietLabel;

const perfil = (
  alergias: AllergenCode[],
  cambios: Partial<PerfilRestricciones> = {},
): PerfilRestricciones => ({
  alergias,
  dietas: [],
  modo_estricto: false,
  ...cambios,
});
// La mayoría de los casos solo usan alergias.
const evaluar = (
  producto: Producto,
  alergias: AllergenCode[],
  cambios?: Partial<PerfilRestricciones>,
) => evaluarCompatibilidad(producto, perfil(alergias, cambios));
const respaldo = (
  producto: Producto,
  alergias: AllergenCode[],
  cambios?: Partial<PerfilRestricciones>,
) => veredictoDeRespaldo(producto, perfil(alergias, cambios));

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
    expect(evaluar(galletas, [LACTEOS, MANI])).toEqual({
      veredicto: "no_apto",
      alergenos_en_conflicto: [LACTEOS],
      dietas_contradichas: [],
      trazas_en_conflicto: [MANI],
      dietas_no_confirmadas: [],
      datos_suficientes: true,
      motivos_no_apto: [{ tipo: "alergeno", codigo: LACTEOS }],
    });
  });

  it("no_apto por alérgeno aunque los datos sean insuficientes", () => {
    const local = evaluar(con({ calidad: calidad(0.2) }), [LACTEOS]);

    expect(local.veredicto).toBe("no_apto");
    expect(local.datos_suficientes).toBe(false);
  });

  it("las trazas en conflicto nunca dan apto: apto_con_advertencia", () => {
    expect(evaluar(galletas, [MANI])).toEqual({
      veredicto: "apto_con_advertencia",
      alergenos_en_conflicto: [],
      dietas_contradichas: [],
      trazas_en_conflicto: [MANI],
      dietas_no_confirmadas: [],
      datos_suficientes: true,
      motivos_no_apto: [],
    });
  });

  it("una traza que ya es ingrediente no se cuenta como traza", () => {
    const local = evaluar(con({ trazas: [LACTEOS] }), [LACTEOS]);

    expect(local.alergenos_en_conflicto).toEqual([LACTEOS]);
    expect(local.trazas_en_conflicto).toEqual([]);
  });

  it("apto si no hay conflictos y los datos son suficientes", () => {
    expect(evaluar(galletas, [SOYA]).veredicto).toBe("apto");
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
      expect(evaluar(con(cambios), [SOYA])).toMatchObject({
        veredicto: "apto_con_advertencia",
        alergenos_en_conflicto: [],
        trazas_en_conflicto: [],
        datos_suficientes: false,
        motivos_no_apto: [],
      });
    },
  );

  it("con completitud justo 0,5 los datos alcanzan", () => {
    const local = evaluar(con({ calidad: calidad(0.5) }), [SOYA]);

    expect(local.veredicto).toBe("apto");
    expect(local.datos_suficientes).toBe(true);
  });

  it("sin alergias en el perfil es apto aunque falten datos", () => {
    const local = evaluar(con({ ingredientes: [] }), []);

    expect(local.veredicto).toBe("apto");
    expect(local.datos_suficientes).toBe(false);
  });
});

describe("evaluarCompatibilidad con dietas y modo estricto", () => {
  // Producto sin alérgenos ni trazas, con datos suficientes.
  const avena = con({
    alergenos: [],
    trazas: [],
    etiquetas_dieta: [VEGANO, VEGETARIANO],
  });

  it("un ingrediente que contradice una dieta es no_apto (fila 2)", () => {
    const local = evaluar(con({ alergenos: [LACTEOS, GLUTEN] }), [], {
      dietas: [VEGANO, SIN_GLUTEN],
    });

    expect(local.veredicto).toBe("no_apto");
    expect(local.dietas_contradichas).toEqual([
      { dieta: VEGANO, alergenos: [LACTEOS] },
      { dieta: SIN_GLUTEN, alergenos: [GLUTEN] },
    ]);
    expect(local.motivos_no_apto).toEqual([
      { tipo: "dieta", codigo: VEGANO },
      { tipo: "dieta", codigo: SIN_GLUTEN },
    ]);
  });

  it("una traza que la dieta evita es apto_con_advertencia (fila 3)", () => {
    const local = evaluar(con({ ...avena, trazas: [PESCADO] }), [], {
      dietas: [VEGETARIANO],
    });

    expect(local.veredicto).toBe("apto_con_advertencia");
    expect(local.trazas_en_conflicto).toEqual([PESCADO]);
  });

  it("una dieta que el producto no declara es apto_con_advertencia (fila 6)", () => {
    const local = evaluar(avena, [], { dietas: [SIN_GLUTEN] });

    expect(local.veredicto).toBe("apto_con_advertencia");
    expect(local.dietas_no_confirmadas).toEqual([SIN_GLUTEN]);
  });

  it("sin_lactosa no se contradice con lácteos: solo se confirma con la etiqueta", () => {
    const deslactosada = con({
      alergenos: [LACTEOS],
      trazas: [],
      etiquetas_dieta: [SIN_LACTOSA],
    });

    expect(evaluar(deslactosada, [], { dietas: [SIN_LACTOSA] }).veredicto).toBe(
      "apto",
    );
    expect(
      evaluar(con({ ...deslactosada, etiquetas_dieta: [] }), [], {
        dietas: [SIN_LACTOSA],
      }).dietas_no_confirmadas,
    ).toEqual([SIN_LACTOSA]);
  });

  it("con las dietas declaradas y sin conflictos es apto", () => {
    expect(evaluar(avena, [SOYA], { dietas: [VEGANO] }).veredicto).toBe("apto");
  });

  it("con dietas, los datos insuficientes también advierten (fila 5)", () => {
    const local = evaluar(con({ ...avena, ingredientes: [] }), [], {
      dietas: [VEGANO],
    });

    expect(local.veredicto).toBe("apto_con_advertencia");
    expect(local.datos_suficientes).toBe(false);
  });

  it("en modo estricto las trazas y los datos insuficientes son no_apto", () => {
    expect(
      evaluar(con({ ...avena, trazas: [MANI] }), [MANI], {
        modo_estricto: true,
      }),
    ).toMatchObject({
      veredicto: "no_apto",
      motivos_no_apto: [{ tipo: "traza", codigo: MANI }],
    });
    expect(
      evaluar(con({ ...avena, ingredientes: [] }), [SOYA], {
        modo_estricto: true,
      }),
    ).toMatchObject({
      veredicto: "no_apto",
      motivos_no_apto: [{ tipo: "datos_insuficientes", codigo: null }],
    });
  });

  it("en modo estricto una dieta no declarada sigue siendo apto_con_advertencia", () => {
    const local = evaluar(avena, [], {
      dietas: [SIN_GLUTEN],
      modo_estricto: true,
    });

    expect(local.veredicto).toBe("apto_con_advertencia");
    expect(local.motivos_no_apto).toEqual([]);
  });
});

describe("veredictoDeRespaldo", () => {
  it("arma un Veredicto completo con confianza baja y el aviso", () => {
    expect(respaldo(galletas, [LACTEOS, MANI])).toEqual({
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
    const veredicto = respaldo(galletas, [SOYA]);

    expect(veredicto.veredicto).toBe("apto_con_advertencia");
    expect(veredicto).not.toHaveProperty("apto");
    expect(veredicto.motivos_no_apto).toEqual([]);
    expect(veredicto.explicacion).toContain(
      "No encontramos tus alérgenos, pero sin el servicio de evaluación no podemos confirmarlo.",
    );
  });

  it("con el perfil vacío tampoco responde apto", () => {
    expect(respaldo(galletas, []).veredicto).toBe("apto_con_advertencia");
  });

  it("trazas en conflicto: apto_con_advertencia sin motivos_no_apto", () => {
    const veredicto = respaldo(galletas, [MANI]);

    expect(veredicto.veredicto).toBe("apto_con_advertencia");
    expect(veredicto.motivos_no_apto).toEqual([]);
    expect(veredicto.explicacion).toContain("Puede contener trazas de maní.");
  });

  it("lista varios alérgenos en la explicación", () => {
    const veredicto = respaldo(con({ alergenos: [GLUTEN, LACTEOS, SOYA] }), [
      GLUTEN,
      LACTEOS,
      SOYA,
    ]);

    expect(veredicto.explicacion).toContain(
      "Contiene gluten, lácteos y soya, que están en tu perfil.",
    );
    expect(veredicto.motivos_no_apto).toHaveLength(3);
  });

  it("marca el origen texto y lo refleja en motivos_confianza", () => {
    const veredicto = respaldo(
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
    const veredicto = respaldo(con({ calidad: calidad(completitud) }), [SOYA]);

    expect(veredicto.motivos_confianza).toEqual(motivos);
  });

  it("sin ingredientes lo dice en la explicación y en motivos_confianza", () => {
    const veredicto = respaldo(con({ ingredientes: [] }), [SOYA]);

    expect(veredicto.datos_suficientes).toBe(false);
    expect(veredicto.motivos_confianza).toContain("sin_ingredientes");
    expect(veredicto.explicacion).toContain(
      "No podemos revisarlo bien: no tiene lista de ingredientes.",
    );
  });

  it("con datos incompletos (pero con ingredientes) lo dice en la explicación", () => {
    const veredicto = respaldo(con({ calidad: calidad(0.3) }), [SOYA]);

    expect(veredicto.explicacion).toContain(
      "No podemos revisarlo bien: sus datos están incompletos.",
    );
  });
});

describe("veredictoDeRespaldo con dietas y modo estricto", () => {
  it("informa la dieta contradicha en conflictos, motivos y explicación", () => {
    const veredicto = respaldo(
      con({ alergenos: [LACTEOS], trazas: [], etiquetas_dieta: [] }),
      [],
      { dietas: [VEGANO] },
    );

    expect(veredicto.veredicto).toBe("no_apto");
    expect(veredicto.conflictos).toEqual([
      { codigo: VEGANO, tipo: "dieta", origen: "fuente" },
    ]);
    expect(veredicto.motivos_no_apto).toEqual([
      { tipo: "dieta", codigo: VEGANO },
    ]);
    expect(veredicto.explicacion).toContain(
      "No cumple la dieta vegana: contiene lácteos.",
    );
  });

  it("lista las dietas no confirmadas y nunca responde apto", () => {
    const veredicto = respaldo(
      con({ alergenos: [], trazas: [], etiquetas_dieta: [] }),
      [],
      { dietas: [VEGANO, SIN_GLUTEN] },
    );

    expect(veredicto.veredicto).toBe("apto_con_advertencia");
    expect(veredicto.dietas_no_confirmadas).toEqual([VEGANO, SIN_GLUTEN]);
    expect(veredicto.explicacion).toContain(
      "No indica que cumpla las dietas vegana y sin gluten.",
    );
  });

  it("dice cuando es no apto solo por el modo estricto", () => {
    const veredicto = respaldo(galletas, [MANI], { modo_estricto: true });

    expect(veredicto.veredicto).toBe("no_apto");
    expect(veredicto.motivos_no_apto).toEqual([
      { tipo: "traza", codigo: MANI },
    ]);
    expect(veredicto.explicacion).toContain(
      "Con el modo estricto, esto lo hace no apto.",
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
      const conTipo = motivos.map((m) => ({ tipo: "alergeno" as const, ...m }));
      expect(textoNoAptos(total, conTipo, ocultos)).toBe(texto);
    },
  );
});

describe("textoNoAptos con otros motivos", () => {
  it("describe dietas, trazas y datos insuficientes", () => {
    expect(
      textoNoAptos(
        4,
        [
          { tipo: "dieta", codigo: VEGANO, cantidad: 2 },
          { tipo: "traza", codigo: MANI, cantidad: 1 },
          { tipo: "datos_insuficientes", codigo: null, cantidad: 1 },
        ],
        true,
      ),
    ).toBe(
      "4 ocultos: 2 por no cumplir la dieta vegana, 1 por poder contener maní y 1 por falta de datos.",
    );
  });
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
