import { ConflictException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { UsersService } from "./users.service";
import { User } from "./user.entity";

const DATOS = {
  nombre: "Ana",
  correo: "ana@correo.cl",
  password: "secreta123",
  alergias: ["mani"],
};

describe("UsersService.createTestUser", () => {
  let service: UsersService;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((datos) => datos),
      save: jest.fn(async (u) => ({ ...u, id: "uuid-1" }) as User),
    };
    service = new UsersService(repo as never);
  });

  it("guarda la contraseña hasheada y no la devuelve", async () => {
    const usuario = await service.createTestUser(DATOS);

    expect(usuario).toEqual({
      id: "uuid-1",
      nombre: "Ana",
      correo: "ana@correo.cl",
      alergias: ["mani"],
    });
    expect(usuario).not.toHaveProperty("password");
    const guardado = repo.save.mock.calls[0][0];
    expect(guardado.password).not.toBe("secreta123");
    expect(guardado.password).toMatch(/^\$2[aby]\$10\$/);
  });

  it("responde 409 si el correo ya existe", async () => {
    repo.findOne.mockResolvedValue({ id: "otro" });

    await expect(service.createTestUser(DATOS)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("responde 409 si el UNIQUE de la base rechaza un registro simultáneo", async () => {
    repo.save.mockRejectedValue(
      new QueryFailedError("INSERT", [], { code: "23505" } as never),
    );

    await expect(service.createTestUser(DATOS)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("propaga otros errores de la base", async () => {
    repo.save.mockRejectedValue(new Error("conexión perdida"));

    await expect(service.createTestUser(DATOS)).rejects.toThrow(
      "conexión perdida",
    );
  });
});
