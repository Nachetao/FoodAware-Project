import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { sign } from "jsonwebtoken";
import { FastApiFalso } from "./fastapi-falso";
import {
  ProductosEnMemoria,
  UsuariosEnMemoria,
  crearApp,
  errorContrato,
  producto,
} from "./app-de-prueba";
import { AllergenCode, DietLabel } from "../../src/products/contrato/enums";
import { Rol } from "../../src/users/rol";
import { Producto } from "../../src/products/contrato/producto";

const ANA_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b";
const token = () =>
  `Bearer ${sign({ sub: ANA_ID, correo: "ana@correo.cl", rol: Rol.USUARIO }, process.env.JWT_SECRET!)}`;
const AVISO =
  "Clasificación orientativa según tu perfil y los datos de Open Food Facts. No es una garantía de que el producto sea seguro para ti: revisa siempre la etiqueta del envase.";

function galleta(
  codigo: string,
  nombre: string,
  alergenos: AllergenCode[],
  trazas: AllergenCode[] = [],
): Producto {
  return { ...producto(codigo, nombre), alergenos, trazas };
}

const avena = galleta("7801234000018", "Galletas de avena", [
  AllergenCode.GLUTEN,
]);
const conLeche = galleta("7801234000025", "Galletas con leche", [
  AllergenCode.LACTEOS,
]);
const conTrazas = galleta(
  "7801234000032",
  "Galletas de coco",
  [AllergenCode.GLUTEN],
  [AllergenCode.MANI],
);

function veredicto(codigo: string, tipo: string) {
  return {
    codigo_barras: codigo,
    veredicto: tipo,
    alergenos_en_conflicto: [],
    trazas_en_conflicto: [],
    dietas_no_confirmadas: [],
    conflictos: [],
    motivos_no_apto: [],
    datos_suficientes: true,
    explicacion: "Sin conflictos con tu perfil.",
    confianza: "alta",
    motivos_confianza: [],
    aviso: AVISO,
  };
}

function respuestaMotor(
  resultados: Array<[Producto, string]>,
  modo = "filtrar",
) {
  return {
    consulta: "galletas",
    interpretacion: {
      terminos: ["galleta"],
      restricciones: [],
      no_reconocidas: [],
    },
    perfil_aplicado: {
      alergias: ["lacteos", "mani"],
      dietas: [],
      modo_estricto: false,
    },
    modo,
    total: resultados.length,
    total_base: 3,
    tiempo_ms: 1.8,
    estado_fuente: "online",
    resultados: resultados.map(([p, tipo], i) => ({
      producto: p,
      score: 3 - i,
      posicion: i + 1,
      posicion_base: i + 1,
      veredicto: veredicto(p.codigo_barras, tipo),
    })),
    no_aptos: {
      total: 1,
      ocultos: modo === "filtrar",
      motivos: [{ tipo: "alergeno", codigo: "lacteos", cantidad: 1 }],
      texto: "1 oculto por contener lácteos.",
    },
    comparacion: {
      k: 5,
      top_base: ["7801234000025", "7801234000018"],
      top_personalizado: ["7801234000018"],
      salieron_del_top: [
        {
          codigo_barras: "7801234000025",
          posicion_base: 1,
          posicion: null,
          veredicto: "no_apto",
        },
      ],
      entraron_al_top: [],
    },
    aviso: AVISO,
  };
}

describe("Integración: búsqueda personalizada y /compatibles con el motor", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let productos: ProductosEnMemoria;
  let usuarios: UsuariosEnMemoria;

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, productos, usuarios } = await crearApp(fastapi.url));
  });

  afterAll(async () => {
    await app.close();
    await fastapi.apagar();
  });

  beforeEach(async () => {
    await fastapi.encender();
    fastapi.reiniciar();
    productos.productos.clear();
    usuarios.usuarios.clear();
    usuarios.usuarios.set(ANA_ID, {
      id: ANA_ID,
      nombre: "Ana",
      correo: "ana@correo.cl",
      password: "$2b$10$hash",
      alergias: [AllergenCode.LACTEOS, AllergenCode.MANI],
      dietas: [],
      modo_estricto: false,
      rol: Rol.USUARIO,
    });
  });

  const get = (ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set("Authorization", token())
      .set("X-Request-ID", "int-personalizada");
  const guardar = (...lista: Producto[]) =>
    lista.forEach((p) => productos.productos.set(p.codigo_barras, p));

  const fallas: Array<[string, () => Promise<void> | void]> = [
    ["FastAPI caído", () => fastapi.apagar()],
    [
      "FastAPI sin respuesta (timeout)",
      () => fastapi.responder("/search/personalized", () => "colgado"),
    ],
    [
      "un 500 del motor",
      () =>
        fastapi.responder("/search/personalized", () => ({
          status: 500,
          cuerpo: errorContrato("INTERNAL_ERROR", "Falla"),
        })),
    ],
  ];

  describe("GET /api/products/search/personalizada", () => {
    it("responde 401 sin token", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/products/search/personalizada?q=galletas",
      );

      expect(res.status).toBe(401);
    });

    it("envía consulta, modo y solo el perfil con la clave, y responde lo del motor", async () => {
      const motor = respuestaMotor([[avena, "apto"]], "reordenar");
      fastapi.responder("/search/personalized", () => ({
        status: 200,
        cuerpo: motor,
      }));

      const res = await get(
        "/api/products/search/personalizada?q=galletas&modo=reordenar&limit=5&offset=0",
      );

      expect(res.status).toBe(200);
      expect(res.headers["x-fuente-datos"]).toBe("fastapi");
      expect(res.body).toEqual(motor);
      const [peticion] = fastapi.peticiones;
      expect(peticion).toMatchObject({
        metodo: "POST",
        ruta: "/search/personalized",
        requestId: "int-personalizada",
        claveServicio: "clave-de-integracion",
        cuerpo: {
          consulta: "galletas",
          perfil: {
            alergias: ["lacteos", "mani"],
            dietas: [],
            modo_estricto: false,
          },
          modo: "reordenar",
          limit: 5,
          offset: 0,
        },
      });
      const enviado = JSON.stringify(peticion.cuerpo);
      expect(enviado).not.toContain(ANA_ID);
      expect(enviado).not.toContain("ana@correo.cl");
      // Guarda los productos que trajo el motor (corpus del respaldo).
      expect(productos.productos.get(avena.codigo_barras)).toEqual(avena);
    });

    it("usa modo filtrar por defecto", async () => {
      fastapi.responder("/search/personalized", () => ({
        status: 200,
        cuerpo: respuestaMotor([[avena, "apto"]]),
      }));

      await get("/api/products/search/personalizada?q=galletas");

      expect(fastapi.peticiones[0].cuerpo).toMatchObject({
        modo: "filtrar",
        limit: 10,
        offset: 0,
      });
    });

    it.each([
      ["un modo inválido", "q=galletas&modo=otro"],
      ["una consulta corta", "q=a"],
      ["un limit fuera de rango", "q=galletas&limit=51"],
    ])("responde 422 con %s, sin llamar al motor", async (_caso, query) => {
      const res = await get(`/api/products/search/personalizada?${query}`);

      expect(res.status).toBe(422);
      expect(res.body.error.codigo).toBe("VALIDATION_ERROR");
      expect(fastapi.peticiones).toHaveLength(0);
    });

    it.each(fallas)(
      "con %s ordena los guardados con la regla local (filtrar)",
      async (_caso, provocarFalla) => {
        guardar(avena, conLeche, conTrazas);
        await provocarFalla();

        const res = await get("/api/products/search/personalizada?q=galletas");

        expect(res.status).toBe(200);
        expect(res.headers["x-fuente-datos"]).toBe("respaldo");
        expect(res.body).toMatchObject({
          consulta: "galletas",
          modo: "filtrar",
          total: 2,
          total_base: 3,
          estado_fuente: "cache",
          perfil_aplicado: {
            alergias: ["lacteos", "mani"],
            dietas: [],
            modo_estricto: false,
          },
          no_aptos: {
            total: 1,
            ocultos: true,
            motivos: [{ tipo: "alergeno", codigo: "lacteos", cantidad: 1 }],
            texto: "1 oculto por contener lácteos.",
          },
          comparacion: null,
          aviso: AVISO,
        });
        // Primero el que no tiene conflictos, después el de trazas; nunca "apto".
        expect(
          res.body.resultados.map(
            (r: { producto: Producto; veredicto: { veredicto: string } }) => [
              r.producto.codigo_barras,
              r.veredicto.veredicto,
            ],
          ),
        ).toEqual([
          ["7801234000018", "apto_con_advertencia"],
          ["7801234000032", "apto_con_advertencia"],
        ]);
        expect(res.body.resultados[0].veredicto.motivos_confianza).toContain(
          "evaluacion_de_respaldo",
        );
      },
    );

    it("en respaldo con modo reordenar deja los no aptos al final", async () => {
      guardar(conLeche, avena);
      await fastapi.apagar();

      const res = await get(
        "/api/products/search/personalizada?q=galletas&modo=reordenar",
      );

      expect(res.headers["x-fuente-datos"]).toBe("respaldo");
      expect(res.body.total).toBe(2);
      expect(
        res.body.resultados.map(
          (r: { veredicto: { veredicto: string } }) => r.veredicto.veredicto,
        ),
      ).toEqual(["apto_con_advertencia", "no_apto"]);
      expect(res.body.no_aptos).toMatchObject({
        ocultos: false,
        texto: "1 no apto al final por contener lácteos.",
      });
    });

    it("si el motor falla y la base no tiene coincidencias, responde el error", async () => {
      await fastapi.apagar();

      const res = await get("/api/products/search/personalizada?q=galletas");

      expect(res.status).toBe(503);
      expect(res.body.error.codigo).toBe("SOURCE_UNAVAILABLE");
    });
  });

  describe("GET /api/products/compatibles", () => {
    it("usa el motor en modo filtrar y estricto y responde solo los apto", async () => {
      fastapi.responder("/search/personalized", () => ({
        status: 200,
        cuerpo: respuestaMotor([[avena, "apto"]]),
      }));

      const res = await get("/api/products/compatibles?q=galletas");

      expect(res.status).toBe(200);
      expect(res.headers["x-fuente-datos"]).toBe("fastapi");
      expect(res.body).toEqual({
        consulta: "galletas",
        total: 1,
        tiempo_ms: 1.8,
        estado_fuente: "online",
        resultados: [{ producto: avena, score: 3, posicion: 1 }],
      });
      expect(fastapi.peticiones[0]).toMatchObject({
        ruta: "/search/personalized",
        claveServicio: "clave-de-integracion",
        cuerpo: {
          consulta: "galletas",
          perfil: {
            alergias: ["lacteos", "mani"],
            dietas: [],
            modo_estricto: true,
          },
          modo: "filtrar",
        },
      });
    });

    it('nunca muestra un resultado que no sea "apto"', async () => {
      fastapi.responder("/search/personalized", () => ({
        status: 200,
        cuerpo: respuestaMotor([
          [avena, "apto"],
          [conTrazas, "apto_con_advertencia"],
        ]),
      }));

      const res = await get("/api/products/compatibles?q=galletas");

      expect(
        res.body.resultados.map(
          (r: { producto: Producto }) => r.producto.codigo_barras,
        ),
      ).toEqual(["7801234000018"]);
    });

    describe("con dietas en el perfil", () => {
      beforeEach(() => {
        Object.assign(usuarios.usuarios.get(ANA_ID)!, {
          dietas: [DietLabel.VEGANO],
          modo_estricto: false,
        });
      });

      it("envía las dietas reales y cuenta solo los apto aunque ocupen varias páginas", async () => {
        // 75 apto y después 15 apto_con_advertencia (dieta no declarada).
        const TOTAL_APTOS = 75;
        fastapi.responder("/search/personalized", ({ cuerpo }) => {
          const { offset, limit } = cuerpo as { offset: number; limit: number };
          const indices = Array.from(
            { length: Math.max(0, Math.min(limit, 90 - offset)) },
            (_, i) => offset + i,
          );
          return {
            status: 200,
            cuerpo: {
              ...respuestaMotor(
                indices.map((i) => [
                  avena,
                  i < TOTAL_APTOS ? "apto" : "apto_con_advertencia",
                ]),
              ),
              total: 90,
            },
          };
        });

        const res = await get("/api/products/compatibles?q=galletas&limit=10");

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(TOTAL_APTOS);
        expect(res.body.resultados).toHaveLength(10);
        const cuerpos = fastapi.peticiones.map(
          (p) => p.cuerpo as { offset: number; perfil: object },
        );
        expect(cuerpos.map((c) => c.offset)).toEqual([0, 10, 60]);
        expect(cuerpos[0].perfil).toEqual({
          alergias: ["lacteos", "mani"],
          dietas: ["vegano"],
          modo_estricto: true,
        });
      });

      it("sin motor, el respaldo exige la etiqueta de la dieta", async () => {
        const vegana = {
          ...galleta("7801234000049", "Galletas veganas", []),
          etiquetas_dieta: [DietLabel.VEGANO],
        };
        guardar(avena, conLeche, vegana);
        await fastapi.apagar();

        const res = await get("/api/products/compatibles?q=galletas");

        expect(res.headers["x-fuente-datos"]).toBe("respaldo");
        expect(
          res.body.resultados.map(
            (r: { producto: Producto }) => r.producto.codigo_barras,
          ),
        ).toEqual(["7801234000049"]);
      });
    });

    it.each(fallas)(
      "con %s busca en la base sin alérgenos ni trazas del usuario",
      async (_caso, provocarFalla) => {
        guardar(avena, conLeche, conTrazas);
        await provocarFalla();

        const res = await get("/api/products/compatibles?q=galletas");

        expect(res.status).toBe(200);
        expect(res.headers["x-fuente-datos"]).toBe("respaldo");
        expect(res.body.estado_fuente).toBe("cache");
        expect(
          res.body.resultados.map(
            (r: { producto: Producto }) => r.producto.codigo_barras,
          ),
        ).toEqual(["7801234000018"]);
      },
    );
  });
});
