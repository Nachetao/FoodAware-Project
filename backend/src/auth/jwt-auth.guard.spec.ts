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
import { FoodsController } from "../foods/foods.controller";
import { FoodsService } from "../foods/foods.service";
import { IaController } from "../ia/ia.controller";
import { IaAnalysisService } from "../ia/ia.service";

const SECRETO = "secreto-de-prueba";
const USUARIO_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b";

describe("JwtAuthGuard (guard global)", () => {
  let app: INestApplication;
  let base: string;
  const foodsService = { findAll: jest.fn().mockResolvedValue([]) };
  const iaService = { analizarProducto: jest.fn().mockResolvedValue({}) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [FoodsController, IaController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: { getOrThrow: () => SECRETO } },
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
  beforeEach(() => jest.clearAllMocks());

  const token = (opciones: SignOptions = {}, secreto = SECRETO) =>
    sign({ sub: USUARIO_ID, correo: "ana@correo.cl" }, secreto, opciones);
  const conToken = (t: string) => ({ Authorization: `Bearer ${t}` });

  describe("ruta protegida: GET /api/food", () => {
    it("responde 401 sin token", async () => {
      expect((await fetch(base)).status).toBe(401);
      expect(foodsService.findAll).not.toHaveBeenCalled();
    });

    it.each([
      ["inválido", "no.es.un.jwt"],
      ["firmado con otro secreto", "OTRO"],
      ["expirado", "EXPIRADO"],
    ])("responde 401 con un token %s", async (_caso, valor) => {
      const t =
        valor === "OTRO"
          ? token({}, "otro")
          : valor === "EXPIRADO"
            ? token({ expiresIn: -10 })
            : valor;
      expect((await fetch(base, { headers: conToken(t) })).status).toBe(401);
    });

    it("responde 200 con un token válido", async () => {
      const res = await fetch(base, { headers: conToken(token()) });
      expect(res.status).toBe(200);
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
