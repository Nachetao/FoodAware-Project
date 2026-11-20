import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DataSource } from "typeorm";
import { FastApiFalso } from "../integracion/fastapi-falso";
import { crearAppPostgres, vaciarTablas } from "./app-postgres";

const ANA = { nombre: "Ana", correo: "ana@correo.cl", password: "clave-ana-1" };
const BEA = { nombre: "Bea", correo: "bea@correo.cl", password: "clave-bea-1" };

describe("PostgreSQL real: usuarios, sesión y roles", () => {
  const fastapi = new FastApiFalso();
  let app: INestApplication;
  let base: DataSource;

  beforeAll(async () => {
    await fastapi.iniciar();
    ({ app, base } = await crearAppPostgres(fastapi.url));
  });

  afterAll(async () => {
    await app?.close();
    await fastapi.apagar();
  });

  beforeEach(() => vaciarTablas(base));

  const servidor = () => app.getHttpServer();
  const registrar = (datos: object) =>
    request(servidor()).post("/api/users").send(datos);
  const iniciarSesion = async ({ correo, password }: typeof ANA) => {
    const res = await request(servidor())
      .post("/api/auth/login")
      .send({ correo, password });
    expect(res.status).toBe(201);
    return `Bearer ${res.body.access_token}`;
  };
  const get = (ruta: string, token?: string) => {
    const peticion = request(servidor()).get(ruta);
    return token ? peticion.set("Authorization", token) : peticion;
  };
  /** Cambia el rol directo en la base, como el script admin:asignar. */
  const cambiarRol = (correo: string, rol: string) =>
    base.query("UPDATE users SET rol = $1 WHERE correo = $2", [rol, correo]);
  const filaDe = async (correo: string) =>
    (
      await base.query(
        "SELECT id, rol::text AS rol, password FROM users WHERE correo = $1",
        [correo],
      )
    )[0];

  it("el registro guarda la cuenta con rol usuario y la contraseña cifrada", async () => {
    const res = await registrar(ANA);

    expect(res.status).toBe(201);
    expect(res.body.rol).toBe("usuario");
    const fila = await filaDe(ANA.correo);
    expect(fila.rol).toBe("usuario");
    expect(fila.password).not.toBe(ANA.password);
    expect(fila.password).toMatch(/^\$2[aby]\$/);
  });

  it("un correo repetido responde 409 (restricción unique de la base)", async () => {
    await registrar(ANA);

    const repetido = await registrar({ ...ANA, nombre: "Otra Ana" });

    expect(repetido.status).toBe(409);
    const [{ total }] = await base.query(
      "SELECT count(*)::int AS total FROM users",
    );
    expect(total).toBe(1);
  });

  it("login y perfil leen el usuario guardado en la base", async () => {
    await registrar(ANA);
    const token = await iniciarSesion(ANA);

    const perfil = await get("/api/usuarios/me", token);

    expect(perfil.status).toBe(200);
    expect(perfil.body).toMatchObject({
      nombre: "Ana",
      correo: "ana@correo.cl",
      alergias: [],
      dietas: [],
      modo_estricto: false,
      rol: "usuario",
    });
    expect(perfil.body).not.toHaveProperty("password");
  });

  describe("rutas de administración", () => {
    const RUTAS_ADMIN = ["/api/usuarios", "/api/food"];

    beforeEach(async () => {
      await registrar(ANA);
      await registrar(BEA);
      await cambiarRol(BEA.correo, "administrador");
    });

    it.each(RUTAS_ADMIN)("GET %s responde 401 sin token", async (ruta) => {
      expect((await get(ruta)).status).toBe(401);
    });

    it.each(RUTAS_ADMIN)(
      "GET %s responde 403 a un usuario normal",
      async (ruta) => {
        const token = await iniciarSesion(ANA);

        const res = await get(ruta, token);

        expect(res.status).toBe(403);
      },
    );

    it.each(RUTAS_ADMIN)(
      "GET %s responde 200 a un administrador",
      async (ruta) => {
        const token = await iniciarSesion(BEA);

        const res = await get(ruta, token);

        expect(res.status).toBe(200);
      },
    );

    it("la lista de usuarios sale de la base, ordenada y sin datos sensibles", async () => {
      const token = await iniciarSesion(BEA);

      const res = await get("/api/usuarios", token);

      expect(res.body).toEqual([
        {
          id: (await filaDe(ANA.correo)).id,
          nombre: "Ana",
          correo: "ana@correo.cl",
          rol: "usuario",
        },
        {
          id: (await filaDe(BEA.correo)).id,
          nombre: "Bea",
          correo: "bea@correo.cl",
          rol: "administrador",
        },
      ]);
    });
  });

  describe("cambio de rol en la base después del login", () => {
    beforeEach(() => registrar(ANA));

    it("un usuario ascendido a administrador debe volver a iniciar sesión", async () => {
      const tokenViejo = await iniciarSesion(ANA);
      await cambiarRol(ANA.correo, "administrador");

      expect((await get("/api/usuarios/me", tokenViejo)).status).toBe(401);
      expect((await get("/api/usuarios", tokenViejo)).status).toBe(401);

      const tokenNuevo = await iniciarSesion(ANA);
      expect((await get("/api/usuarios", tokenNuevo)).status).toBe(200);
    });

    it("a un administrador degradado su token deja de servir (401)", async () => {
      await cambiarRol(ANA.correo, "administrador");
      const tokenAdmin = await iniciarSesion(ANA);
      await cambiarRol(ANA.correo, "usuario");

      expect((await get("/api/usuarios", tokenAdmin)).status).toBe(401);

      const tokenNuevo = await iniciarSesion(ANA);
      expect((await get("/api/usuarios", tokenNuevo)).status).toBe(403);
    });
  });

  it("borrar la cuenta elimina la fila y el token responde 401", async () => {
    await registrar(ANA);
    const token = await iniciarSesion(ANA);

    const borrar = await request(servidor())
      .delete("/api/usuarios/me")
      .set("Authorization", token);

    expect(borrar.status).toBe(204);
    expect(await filaDe(ANA.correo)).toBeUndefined();
    expect((await get("/api/usuarios/me", token)).status).toBe(401);
  });

  it("PATCH /api/usuarios/me guarda alergias y dietas como arreglos en la base", async () => {
    await registrar(ANA);
    const token = await iniciarSesion(ANA);

    const res = await request(servidor())
      .patch("/api/usuarios/me")
      .set("Authorization", token)
      .send({
        alergias: ["gluten", "mani"],
        dietas: ["vegano"],
        modo_estricto: true,
      });

    expect(res.status).toBe(200);
    const [fila] = await base.query(
      "SELECT alergias, dietas, modo_estricto FROM users WHERE correo = $1",
      [ANA.correo],
    );
    expect(fila).toEqual({
      alergias: ["gluten", "mani"],
      dietas: ["vegano"],
      modo_estricto: true,
    });
  });
});
