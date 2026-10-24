import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { sign } from "jsonwebtoken";
import { FastApiFalso } from "./fastapi-falso";
import {
  ProductosEnMemoria,
  UsuariosEnMemoria,
  crearApp,
  producto,
} from "./app-de-prueba";
import { AllergenCode } from "../../src/products/contrato/enums";
import { Producto } from "../../src/products/contrato/producto";

const ANA_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b";

// Mismo payload que firma AuthService en el login, con el JWT_SECRET de prueba.
const token = (id = ANA_ID) =>
  `Bearer ${sign({ sub: id, correo: "ana@correo.cl" }, process.env.JWT_SECRET!)}`;

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

  beforeEach(() => {
    fastapi.reiniciar();
    productos.productos.clear();
    usuarios.usuarios.clear();
    usuarios.usuarios.set(ANA_ID, {
      id: ANA_ID,
      nombre: "Ana",
      correo: "ana@correo.cl",
      password: "$2b$10$hash",
      alergias: [AllergenCode.LACTEOS, AllergenCode.MANI],
    });
  });

  const servidor = () => app.getHttpServer();

  it.each([
    ["get", "/api/usuarios/me"],
    ["put", "/api/usuarios/me/alergias"],
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

  it("compatibilidad: no apto por un alérgeno; las trazas se informan", async () => {
    const galletas = conAlergenos(
      "7801234000018",
      "Galletas de avena",
      [AllergenCode.GLUTEN, AllergenCode.LACTEOS],
      [AllergenCode.MANI],
    );
    fastapi.responder("/products/7801234000018", () => ({
      status: 200,
      cuerpo: galletas,
    }));

    const res = await request(servidor())
      .get("/api/products/7801234000018/compatibilidad")
      .set("Authorization", token());

    expect(res.status).toBe(200);
    expect(res.headers["x-fuente-datos"]).toBe("fastapi");
    expect(res.body).toEqual({
      apto: false,
      alergenos_en_conflicto: ["lacteos"],
      trazas_en_conflicto: ["mani"],
    });
  });

  it("compatibilidad: apto aunque haya trazas en conflicto", async () => {
    fastapi.responder("/products/7801234000018", () => ({
      status: 200,
      cuerpo: conAlergenos(
        "7801234000018",
        "Galletas",
        [AllergenCode.GLUTEN],
        [AllergenCode.MANI],
      ),
    }));

    const res = await request(servidor())
      .get("/api/products/7801234000018/compatibilidad")
      .set("Authorization", token());

    expect(res.body).toEqual({
      apto: true,
      alergenos_en_conflicto: [],
      trazas_en_conflicto: ["mani"],
    });
  });

  it("compatibles: excluye los productos con alérgenos del usuario", async () => {
    for (const p of [
      conAlergenos("7801234000018", "Galletas de avena con leche", [
        AllergenCode.LACTEOS,
      ]),
      conAlergenos("7801234000025", "Galletas de avena", [AllergenCode.GLUTEN]),
      conAlergenos("7801234000032", "Galletas sin nada", []),
    ]) {
      productos.productos.set(p.codigo_barras, p);
    }

    const res = await request(servidor())
      .get("/api/products/compatibles?q=galletas")
      .set("Authorization", token());

    expect(res.status).toBe(200);
    expect(res.body.estado_fuente).toBe("cache");
    expect(res.body.total).toBe(2);
    expect(
      res.body.resultados.map((r) => r.producto.codigo_barras).sort(),
    ).toEqual(["7801234000025", "7801234000032"]);
    expect(fastapi.peticiones).toHaveLength(0);
  });

  it("compatibles valida la consulta como la búsqueda (422)", async () => {
    const res = await request(servidor())
      .get("/api/products/compatibles?q=a")
      .set("Authorization", token());

    expect(res.status).toBe(422);
    expect(res.body.error.codigo).toBe("VALIDATION_ERROR");
  });
});
