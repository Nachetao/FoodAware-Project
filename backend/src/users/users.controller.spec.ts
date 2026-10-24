import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController (POST /api/users)", () => {
  let app: INestApplication;
  let url: string;
  const usersService = { createTestUser: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    // Misma configuración que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/api/users`;
  });

  afterAll(() => app.close());

  const registrar = (cuerpo: object) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

  const valido = { nombre: "Ana", correo: "ana@correo.cl", password: "x1" };

  it("rechaza con 400 campos que no están en el DTO (por ejemplo, id)", async () => {
    const res = await registrar({ ...valido, id: "otro-usuario" });

    expect(res.status).toBe(400);
    expect(usersService.createTestUser).not.toHaveBeenCalled();
  });

  it("acepta un registro válido", async () => {
    usersService.createTestUser.mockResolvedValue({ id: "uuid-1" });

    const res = await registrar(valido);

    expect(res.status).toBe(201);
    expect(usersService.createTestUser).toHaveBeenCalledWith(valido);
  });

  it("acepta alergias con los códigos del contrato", async () => {
    usersService.createTestUser.mockResolvedValue({ id: "uuid-2" });

    const res = await registrar({ ...valido, alergias: ["mani", "lacteos"] });

    expect(res.status).toBe(201);
  });

  it.each([["maní"], ["chocolate"], ["Lacteos"]])(
    "rechaza con 400 una alergia que no es un código (%s)",
    async (alergia) => {
      usersService.createTestUser.mockClear();

      const res = await registrar({ ...valido, alergias: [alergia] });
      const cuerpo = await res.json();

      expect(res.status).toBe(400);
      expect(cuerpo.message.join(" ")).toContain(
        "Cada alergia debe ser uno de estos códigos: lacteos, gluten",
      );
      expect(usersService.createTestUser).not.toHaveBeenCalled();
    },
  );
});
