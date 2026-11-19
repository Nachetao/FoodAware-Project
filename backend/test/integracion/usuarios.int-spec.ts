import { INestApplication } from "@nestjs/common";
import request from "supertest";
import * as bcrypt from "bcrypt";
import { decode, sign } from "jsonwebtoken";
import { FastApiFalso } from "./fastapi-falso";
import {
  ProductosEnMemoria,
  UsuariosEnMemoria,
  crearApp,
  errorContrato,
  producto,
} from "./app-de-prueba";
import { AllergenCode } from "../../src/products/contrato/enums";
import { Producto } from "../../src/products/contrato/producto";
import { Rol } from "../../src/users/rol";

const ANA_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b";
const ADMIN_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

// Mismo payload que firma AuthService en el login, con el JWT_SECRET de prueba.
const token = (id = ANA_ID, rol = Rol.USUARIO) =>
  `Bearer ${sign({ sub: id, correo: "ana@correo.cl", rol }, process.env.JWT_SECRET!)}`;
const tokenAdmin = () => token(ADMIN_ID, Rol.ADMINISTRADOR);

function conAlergenos(
  codigo: string,
  nombre: string,
  alergenos: AllergenCode[],
  trazas: AllergenCode[] = [],
): Producto {
  return { ...producto(codigo, nombre), alergenos, trazas };
}

describe("Integración: perfil, alergias y compatibilidad (con JWT)", () => {
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
    usuarios.usuarios.set(ADMIN_ID, {
      id: ADMIN_ID,
      nombre: "Admin",
      correo: "admin@correo.cl",
      password: "$2b$10$hash",
      alergias: [AllergenCode.GLUTEN],
      dietas: [],
      modo_estricto: false,
      rol: Rol.ADMINISTRADOR,
    });
  });

  const servidor = () => app.getHttpServer();

  it.each([
    ["get", "/api/usuarios/me"],
    ["put", "/api/usuarios/me/alergias"],
    ["patch", "/api/usuarios/me"],
    ["delete", "/api/usuarios/me"],
    ["get", "/api/products/7801234000018/compatibilidad"],
    ["get", "/api/products/compatibles?q=galletas"],
  ] as const)("%s %s responde 401 sin token", async (metodo, ruta) => {
    const res = await request(servidor())[metodo](ruta);
    expect(res.status).toBe(401);
  });

  it("GET /api/usuarios/me devuelve el perfil sin password", async () => {
    const res = await request(servidor())
      .get("/api/usuarios/me")
      .set("Authorization", token());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ANA_ID,
      nombre: "Ana",
      correo: "ana@correo.cl",
      alergias: ["lacteos", "mani"],
      dietas: [],
      modo_estricto: false,
      rol: "usuario",
    });
  });

  describe("PATCH /api/usuarios/me", () => {
    const editar = (cuerpo: object) =>
      request(servidor())
        .patch("/api/usuarios/me")
        .set("Authorization", token())
        .send(cuerpo);

    it("cambia nombre, alergias, dietas y modo estricto, y solo esos", async () => {
      const res = await editar({
        nombre: "  Ana María ",
        alergias: ["gluten"],
        dietas: ["vegano", "sin_gluten"],
        modo_estricto: true,
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: ANA_ID,
        nombre: "Ana María",
        correo: "ana@correo.cl",
        alergias: ["gluten"],
        dietas: ["vegano", "sin_gluten"],
        modo_estricto: true,
        rol: "usuario",
      });
    });

    it("un cambio parcial conserva lo demás", async () => {
      const res = await editar({ modo_estricto: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        nombre: "Ana",
        alergias: ["lacteos", "mani"],
        dietas: [],
        modo_estricto: true,
      });
    });

    it.each([
      ["el rol", { rol: "administrador" }],
      ["el correo", { correo: "otra@correo.cl" }],
      ["la contraseña", { password: "nueva" }],
      ["una dieta desconocida", { dietas: ["paleo"] }],
      ["un nombre vacío", { nombre: "   " }],
      ["un modo estricto que no es booleano", { modo_estricto: "si" }],
    ])("rechaza con 400 %s", async (_caso, cuerpo) => {
      const res = await editar(cuerpo);

      expect(res.status).toBe(400);
      expect(usuarios.usuarios.get(ANA_ID)).toMatchObject({
        nombre: "Ana",
        correo: "ana@correo.cl",
        rol: Rol.USUARIO,
      });
    });

    it("el motor recibe las dietas y el modo estricto guardados, sin datos personales", async () => {
      await editar({ dietas: ["vegetariano"], modo_estricto: true });
      fastapi.responder("/products/7801234000018/compatibility", () => ({
        status: 200,
        cuerpo: {
          codigo_barras: "7801234000018",
          veredicto: "apto",
          alergenos_en_conflicto: [],
          trazas_en_conflicto: [],
          dietas_no_confirmadas: [],
          conflictos: [],
          motivos_no_apto: [],
          datos_suficientes: true,
          explicacion: "Sin conflictos con tu perfil.",
          confianza: "alta",
          motivos_confianza: [],
          aviso: "Clasificación orientativa.",
        },
      }));

      await request(servidor())
        .get("/api/products/7801234000018/compatibilidad")
        .set("Authorization", token());

      const enviado = fastapi.peticiones[0].cuerpo as { perfil: object };
      expect(enviado).toEqual({
        perfil: {
          alergias: ["lacteos", "mani"],
          dietas: ["vegetariano"],
          modo_estricto: true,
        },
      });
      expect(JSON.stringify(enviado)).not.toMatch(/ana@correo|Ana|usuario/);
    });
  });

  describe("DELETE /api/usuarios/me", () => {
    it("borra la cuenta y desde ese momento el token responde 401", async () => {
      const borrar = await request(servidor())
        .delete("/api/usuarios/me")
        .set("Authorization", token());
      const despues = await request(servidor())
        .get("/api/usuarios/me")
        .set("Authorization", token());

      expect(borrar.status).toBe(204);
      expect(usuarios.usuarios.has(ANA_ID)).toBe(false);
      expect(usuarios.usuarios.has(ADMIN_ID)).toBe(true);
      expect(despues.status).toBe(401);
    });
  });

  describe("roles", () => {
    it("el login firma el rol en el JWT y ese token sirve en las rutas privadas", async () => {
      usuarios.usuarios.get(ADMIN_ID)!.password = await bcrypt.hash(
        "clave-admin",
        4,
      );

      const login = await request(servidor())
        .post("/api/auth/login")
        .send({ correo: "admin@correo.cl", password: "clave-admin" });

      expect(login.status).toBe(201);
      expect(decode(login.body.access_token)).toMatchObject({
        sub: ADMIN_ID,
        rol: "administrador",
      });
      const lista = await request(servidor())
        .get("/api/usuarios")
        .set("Authorization", `Bearer ${login.body.access_token}`);
      expect(lista.status).toBe(200);
    });

    it("el registro crea siempre un usuario y rechaza elegir el rol", async () => {
      const datos = {
        nombre: "Bea",
        correo: "bea@correo.cl",
        password: "clave-bea",
      };

      const conRol = await request(servidor())
        .post("/api/users")
        .send({ ...datos, rol: "administrador" });
      const normal = await request(servidor()).post("/api/users").send(datos);

      expect(conRol.status).toBe(400);
      expect(normal.status).toBe(201);
      expect(normal.body.rol).toBe("usuario");
    });

    it.each([["/api/usuarios"], ["/api/food"]])(
      "GET %s: 401 sin token, 403 a un usuario y 200 a un administrador",
      async (ruta) => {
        const sinToken = await request(servidor()).get(ruta);
        const usuario = await request(servidor())
          .get(ruta)
          .set("Authorization", token());
        const admin = await request(servidor())
          .get(ruta)
          .set("Authorization", tokenAdmin());

        expect(sinToken.status).toBe(401);
        expect(usuario.status).toBe(403);
        expect(admin.status).toBe(200);
      },
    );

    it("la lista de usuarios no incluye contraseñas ni datos de salud", async () => {
      const res = await request(servidor())
        .get("/api/usuarios")
        .set("Authorization", tokenAdmin());

      expect(res.body).toEqual([
        {
          id: ADMIN_ID,
          nombre: "Admin",
          correo: "admin@correo.cl",
          rol: "administrador",
        },
        { id: ANA_ID, nombre: "Ana", correo: "ana@correo.cl", rol: "usuario" },
      ]);
    });

    it("un token con un rol que ya no coincide con la base responde 401", async () => {
      usuarios.usuarios.get(ADMIN_ID)!.rol = Rol.USUARIO;

      const res = await request(servidor())
        .get("/api/usuarios/me")
        .set("Authorization", tokenAdmin());

      expect(res.status).toBe(401);
    });

    it("un token de un usuario que ya no existe responde 401", async () => {
      usuarios.usuarios.delete(ANA_ID);

      const res = await request(servidor())
        .get("/api/usuarios/me")
        .set("Authorization", token());

      expect(res.status).toBe(401);
    });
  });

  it("PUT /api/usuarios/me/alergias reemplaza las alergias", async () => {
    const res = await request(servidor())
      .put("/api/usuarios/me/alergias")
      .set("Authorization", token())
      .send({ alergias: ["gluten", "soya"] });

    expect(res.status).toBe(200);
    expect(res.body.alergias).toEqual(["gluten", "soya"]);
    expect(usuarios.usuarios.get(ANA_ID)!.alergias).toEqual(["gluten", "soya"]);
  });

  it("PUT /api/usuarios/me/alergias rechaza códigos inválidos", async () => {
    const res = await request(servidor())
      .put("/api/usuarios/me/alergias")
      .set("Authorization", token())
      .send({ alergias: ["maní"] });

    expect(res.status).toBe(400);
    expect(res.body.message.join(" ")).toContain(
      "Cada alergia debe ser uno de estos códigos",
    );
  });

  describe("compatibilidad con el motor adaptativo", () => {
    const RUTA_MOTOR = "/products/7801234000018/compatibility";
    const compatibilidad = () =>
      request(servidor())
        .get("/api/products/7801234000018/compatibilidad")
        .set("Authorization", token())
        .set("X-Request-ID", "int-compat");
    const galletas = conAlergenos(
      "7801234000018",
      "Galletas de avena",
      [AllergenCode.GLUTEN],
      [AllergenCode.MANI],
    );
    const veredictoMotor = {
      codigo_barras: "7801234000018",
      veredicto: "apto_con_advertencia",
      alergenos_en_conflicto: [],
      trazas_en_conflicto: ["mani"],
      dietas_no_confirmadas: [],
      conflictos: [{ codigo: "mani", tipo: "traza", origen: "fuente" }],
      motivos_no_apto: [],
      datos_suficientes: true,
      explicacion: "Puede contener maní, que está en tu perfil.",
      confianza: "alta",
      motivos_confianza: [],
      aviso:
        "Clasificación orientativa según tu perfil y los datos de Open Food Facts. No es una garantía de que el producto sea seguro para ti: revisa siempre la etiqueta del envase.",
    };

    it("envía solo el perfil con la clave y responde el Veredicto del motor", async () => {
      fastapi.responder(RUTA_MOTOR, () => ({
        status: 200,
        cuerpo: veredictoMotor,
      }));

      const res = await compatibilidad();

      expect(res.status).toBe(200);
      expect(res.headers["x-fuente-datos"]).toBe("fastapi");
      expect(res.body).toEqual({ ...veredictoMotor, apto: false });

      const [peticion] = fastapi.peticiones;
      expect(peticion).toMatchObject({
        metodo: "POST",
        ruta: RUTA_MOTOR,
        requestId: "int-compat",
        claveServicio: "clave-de-integracion",
        cuerpo: {
          perfil: {
            alergias: ["lacteos", "mani"],
            dietas: [],
            modo_estricto: false,
          },
        },
      });
      // Nada que identifique a la persona.
      const enviado = JSON.stringify(peticion.cuerpo);
      expect(enviado).not.toContain(ANA_ID);
      expect(enviado).not.toContain("ana@correo.cl");
      expect(enviado).not.toContain("Ana");
    });

    it("apto es true solo si el motor responde apto", async () => {
      fastapi.responder(RUTA_MOTOR, () => ({
        status: 200,
        cuerpo: {
          ...veredictoMotor,
          veredicto: "apto",
          trazas_en_conflicto: [],
          conflictos: [],
        },
      }));

      const res = await compatibilidad();

      expect(res.body.veredicto).toBe("apto");
      expect(res.body.apto).toBe(true);
    });

    it("propaga el 404 del motor", async () => {
      fastapi.responder(RUTA_MOTOR, () => ({
        status: 404,
        cuerpo: errorContrato("NOT_FOUND", "Producto no encontrado"),
      }));
      productos.productos.set(galletas.codigo_barras, galletas);

      const res = await compatibilidad();

      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("NOT_FOUND");
    });

    it.each([
      ["FastAPI caído", () => fastapi.apagar()],
      [
        "FastAPI sin respuesta (timeout)",
        async () => fastapi.responder(RUTA_MOTOR, () => "colgado"),
      ],
      [
        "un 503 del motor",
        async () =>
          fastapi.responder(RUTA_MOTOR, () => ({
            status: 503,
            cuerpo: errorContrato("SOURCE_UNAVAILABLE", "Sin fuente"),
          })),
      ],
      [
        "un 403 (clave rechazada)",
        async () =>
          fastapi.responder(RUTA_MOTOR, () => ({
            status: 403,
            cuerpo: errorContrato("FORBIDDEN", "Clave inválida"),
          })),
      ],
    ])(
      "con %s responde la regla local desde la base, nunca apto",
      async (_caso, provocarFalla) => {
        productos.productos.set(galletas.codigo_barras, galletas);
        await provocarFalla();

        const res = await compatibilidad();

        expect(res.status).toBe(200);
        expect(res.headers["x-fuente-datos"]).toBe("respaldo");
        expect(res.body).toMatchObject({
          codigo_barras: "7801234000018",
          veredicto: "apto_con_advertencia",
          apto: false,
          alergenos_en_conflicto: [],
          trazas_en_conflicto: ["mani"],
          confianza: "baja",
        });
        expect(res.body.motivos_confianza).toContain("evaluacion_de_respaldo");
        expect(res.body.explicacion).toContain(
          "El servicio de evaluación no está disponible",
        );
        expect(res.body.aviso).toContain("Clasificación orientativa");
      },
    );

    it("en respaldo, sin conflictos tampoco responde apto", async () => {
      const avena = conAlergenos("7801234000018", "Avena", [
        AllergenCode.GLUTEN,
      ]);
      productos.productos.set(avena.codigo_barras, avena);
      await fastapi.apagar();

      const res = await compatibilidad();

      expect(res.headers["x-fuente-datos"]).toBe("respaldo");
      expect(res.body.veredicto).toBe("apto_con_advertencia");
      expect(res.body.apto).toBe(false);
    });

    it("en respaldo, un alérgeno del perfil es no_apto", async () => {
      productos.productos.set(
        "7801234000018",
        conAlergenos("7801234000018", "Galletas con leche", [
          AllergenCode.LACTEOS,
        ]),
      );
      await fastapi.apagar();

      const res = await compatibilidad();

      expect(res.body).toMatchObject({
        veredicto: "no_apto",
        apto: false,
        alergenos_en_conflicto: ["lacteos"],
        motivos_no_apto: [{ tipo: "alergeno", codigo: "lacteos" }],
      });
    });

    it("si el motor falla y el producto no está guardado, responde el error (503)", async () => {
      await fastapi.apagar();

      const res = await compatibilidad();

      expect(res.status).toBe(503);
      expect(res.body.error.codigo).toBe("SOURCE_UNAVAILABLE");
    });
  });

  it("compatibles sin motor: excluye los guardados con alérgenos o trazas del usuario", async () => {
    for (const p of [
      conAlergenos("7801234000018", "Galletas de avena con leche", [
        AllergenCode.LACTEOS,
      ]),
      conAlergenos("7801234000025", "Galletas de avena", [AllergenCode.GLUTEN]),
      conAlergenos("7801234000032", "Galletas sin nada", []),
      conAlergenos(
        "7801234000049",
        "Galletas que pueden contener maní",
        [AllergenCode.GLUTEN],
        [AllergenCode.MANI],
      ),
    ]) {
      productos.productos.set(p.codigo_barras, p);
    }
    await fastapi.apagar();

    const res = await request(servidor())
      .get("/api/products/compatibles?q=galletas")
      .set("Authorization", token());

    expect(res.status).toBe(200);
    expect(res.headers["x-fuente-datos"]).toBe("respaldo");
    expect(res.body.estado_fuente).toBe("cache");
    expect(res.body.total).toBe(2);
    expect(
      res.body.resultados.map((r) => r.producto.codigo_barras).sort(),
    ).toEqual(["7801234000025", "7801234000032"]);
  });

  it("compatibles valida la consulta como la búsqueda (422)", async () => {
    const res = await request(servidor())
      .get("/api/products/compatibles?q=a")
      .set("Authorization", token());

    expect(res.status).toBe(422);
    expect(res.body.error.codigo).toBe("VALIDATION_ERROR");
  });
});
