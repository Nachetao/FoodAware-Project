import { INestApplication } from "@nestjs/common";
import { readdirSync } from "fs";
import { join } from "path";
import request from "supertest";
import { DataSource } from "typeorm";
import { FastApiFalso } from "../integracion/fastapi-falso";
import { crearAppPostgres } from "./app-postgres";

describe("PostgreSQL real: migraciones y esquema", () => {
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

  it("el arranque aplica todas las migraciones sobre una base vacía", async () => {
    const archivos = readdirSync(
      join(__dirname, "../../src/migrations"),
    ).filter((f) => f.endsWith(".ts"));
    const aplicadas: Array<{ name: string }> = await base.query(
      "SELECT name FROM migrations ORDER BY id",
    );

    expect(aplicadas).toHaveLength(archivos.length);
    expect(await base.showMigrations()).toBe(false);
  });

  it("el esquema que dejan las migraciones coincide con las entidades", async () => {
    // Lo que TypeORM tendría que ejecutar para igualar la base a las
    // entidades. Vacío = migraciones y entidades sincronizadas.
    const pendiente = await base.driver.createSchemaBuilder().log();

    expect(pendiente.upQueries.map((q) => q.query)).toEqual([]);
  });

  it("users.rol es el enum rol_usuario: la base rechaza un rol desconocido", async () => {
    const [{ valores }] = await base.query(
      "SELECT enum_range(NULL::rol_usuario)::text[] AS valores",
    );
    expect(valores).toEqual(["usuario", "administrador"]);

    await expect(
      base.query(
        "INSERT INTO users (nombre, correo, password, rol) VALUES ('X', 'x@correo.cl', 'h', 'superusuario')",
      ),
    ).rejects.toThrow(/rol_usuario/);
  });

  it("GET /api/health reporta PostgreSQL ok con la base real", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");

    expect(res.body.dependencias.postgresql).toBe("ok");
  });
});
