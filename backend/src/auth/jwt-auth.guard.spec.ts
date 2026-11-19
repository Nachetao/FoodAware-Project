import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
// @nestjs/jwt es ESM y Jest (CommonJS) no lo carga; se firma con jsonwebtoken,
// la misma librería que verifica passport-jwt.
import { sign, SignOptions } from "jsonwebtoken";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtStrategy } from "./jwt.strategy";
import { RolesGuard } from "./roles.guard";
import { FoodsController } from "../foods/foods.controller";
import { FoodsService } from "../foods/foods.service";
import { IaController } from "../ia/ia.controller";
import { IaAnalysisService } from "../ia/ia.service";
import { Rol } from "../users/rol";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";

const SECRETO = "secreto-de-prueba";
const USUARIO_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b";
const ADMIN_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("JwtAuthGuard y RolesGuard (guards globales)", () => {
  let app: INestApplication;
  let base: string;
  const foodsService = { findAll: jest.fn().mockResolvedValue([]) };
  const iaService = { analizarProducto: jest.fn().mockResolvedValue({}) };
  // La "base": JwtStrategy busca aquí al usuario del token en cada petición.
  const usuarios = new Map<string, Partial<User>>();
  const usersService = {
    buscarPorId: jest.fn(async (id: string) => usuarios.get(id) ?? null),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [FoodsController, IaController],
      providers: [
        JwtStrategy,
        // Mismo orden que AuthModule: primero el JWT, después los roles.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: ConfigService, useValue: { getOrThrow: () => SECRETO } },
        { provide: UsersService, useValue: usersService },
        { provide: FoodsService, useValue: foodsService },
        { provide: IaAnalysisService, useValue: iaService },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    base = `${await app.getUrl()}/api/food`;
  });

  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    usuarios.clear();
    usuarios.set(USUARIO_ID, {
      id: USUARIO_ID,
      correo: "ana@correo.cl",
      rol: Rol.USUARIO,
    });
    usuarios.set(ADMIN_ID, {
      id: ADMIN_ID,
      correo: "admin@correo.cl",
      rol: Rol.ADMINISTRADOR,
    });
  });

  const firmar = (
    payload: object,
    opciones: SignOptions = {},
    secreto = SECRETO,
  ) => sign(payload, secreto, opciones);
  const token = (opciones: SignOptions = {}, secreto = SECRETO) =>
    firmar(
      { sub: USUARIO_ID, correo: "ana@correo.cl", rol: Rol.USUARIO },
      opciones,
      secreto,
    );
  const tokenAdmin = (opciones: SignOptions = {}, secreto = SECRETO) =>
    firmar(
      { sub: ADMIN_ID, correo: "admin@correo.cl", rol: Rol.ADMINISTRADOR },
      opciones,
      secreto,
    );
  const conToken = (t: string) => ({ Authorization: `Bearer ${t}` });
  const estado = async (t?: string) =>
    (await fetch(base, t ? { headers: conToken(t) } : {})).status;

  describe("ruta solo para administradores: GET /api/food", () => {
    it("responde 401 sin token", async () => {
      expect(await estado()).toBe(401);
      expect(foodsService.findAll).not.toHaveBeenCalled();
    });

    it.each([
      ["inválido", () => "no.es.un.jwt"],
      ["firmado con otro secreto", () => tokenAdmin({}, "otro")],
      ["expirado", () => tokenAdmin({ expiresIn: -10 })],
    ])("responde 401 con un token %s", async (_caso, crear) => {
      expect(await estado(crear())).toBe(401);
    });

    it("responde 200 con el token de un administrador", async () => {
      expect(await estado(tokenAdmin())).toBe(200);
      expect(foodsService.findAll).toHaveBeenCalled();
    });

    it("responde 403 con el token válido de un usuario sin ese rol", async () => {
      expect(await estado(token())).toBe(403);
      expect(foodsService.findAll).not.toHaveBeenCalled();
    });

    it("responde 401 si al administrador le quitaron el rol después del login", async () => {
      usuarios.set(ADMIN_ID, { ...usuarios.get(ADMIN_ID), rol: Rol.USUARIO });

      expect(await estado(tokenAdmin())).toBe(401);
      expect(foodsService.findAll).not.toHaveBeenCalled();
    });

    it("responde 401 si el token es anterior a los roles (sin rol)", async () => {
      expect(
        await estado(firmar({ sub: ADMIN_ID, correo: "admin@correo.cl" })),
      ).toBe(401);
    });

    it("responde 401 si el usuario del token ya no existe", async () => {
      usuarios.delete(ADMIN_ID);

      expect(await estado(tokenAdmin())).toBe(401);
    });
  });

  describe("ruta pública con token opcional: POST /api/food/analizar", () => {
    const analizar = (cuerpo: object, headers = {}) =>
      fetch(`${base}/analizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(cuerpo),
      });
    const producto = { nombre: "Barrita", ingredientes: ["avena", "maní"] };

    it("sin token analiza sin usuario", async () => {
      expect((await analizar(producto)).status).toBe(201);
      expect(iaService.analizarProducto).toHaveBeenCalledWith(
        "Barrita",
        ["avena", "maní"],
        undefined,
      );
    });

    it("con un token válido usa el usuario del token", async () => {
      await analizar(producto, conToken(token()));
      expect(iaService.analizarProducto).toHaveBeenCalledWith(
        "Barrita",
        ["avena", "maní"],
        USUARIO_ID,
      );
    });

    it("con el token de un usuario que ya no existe analiza sin usuario", async () => {
      usuarios.delete(USUARIO_ID);

      const res = await analizar(producto, conToken(token()));

      expect(res.status).toBe(201);
      expect(iaService.analizarProducto).toHaveBeenCalledWith(
        "Barrita",
        ["avena", "maní"],
        undefined,
      );
    });

    it("con un token inválido analiza sin usuario, sin rechazar", async () => {
      const res = await analizar(producto, conToken("no.es.un.jwt"));
      expect(res.status).toBe(201);
      expect(iaService.analizarProducto).toHaveBeenCalledWith(
        "Barrita",
        ["avena", "maní"],
        undefined,
      );
    });

    it("ignora el userId del body", async () => {
      await analizar({ ...producto, userId: "otro-usuario" });
      expect(iaService.analizarProducto).toHaveBeenCalledWith(
        "Barrita",
        ["avena", "maní"],
        undefined,
      );
    });
  });
});
