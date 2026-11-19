import { ConflictException, NotFoundException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { UsersService } from "./users.service";
import { User } from "./user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { AllergenCode } from "../products/contrato/enums";
import { Rol } from "./rol";

const DATOS: CreateUserDto = {
  nombre: "Ana",
  correo: "ana@correo.cl",
  password: "secreta123",
  alergias: [AllergenCode.MANI],
};

describe("UsersService.createTestUser", () => {
  let service: UsersService;
  let repo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
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
      rol: "usuario",
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

  it("el registro siempre crea el rol usuario", async () => {
    await service.createTestUser(DATOS);

    expect(repo.save.mock.calls[0][0].rol).toBe(Rol.USUARIO);
  });

  it("guarda alergias vacías si no vienen", async () => {
    const sinAlergias = { ...DATOS, alergias: undefined };

    const usuario = await service.createTestUser(sinAlergias);

    expect(repo.save.mock.calls[0][0].alergias).toEqual([]);
    expect(usuario.alergias).toEqual([]);
  });

  describe("perfil y alergias", () => {
    const guardado = {
      id: "u1",
      nombre: "Ana",
      correo: "ana@correo.cl",
      password: "$2b$10$hash",
      alergias: [AllergenCode.MANI],
      rol: Rol.USUARIO,
    } as User;

    it("perfil devuelve el usuario sin password", async () => {
      repo.findOne.mockResolvedValue(guardado);

      const perfil = await service.perfil("u1");

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: "u1" } });
      expect(perfil).toEqual({
        id: "u1",
        nombre: "Ana",
        correo: "ana@correo.cl",
        alergias: [AllergenCode.MANI],
        rol: "usuario",
      });
    });

    it("actualizarAlergias reemplaza las alergias sin repetir", async () => {
      repo.findOne.mockResolvedValue({ ...guardado });

      const perfil = await service.actualizarAlergias("u1", [
        AllergenCode.LACTEOS,
        AllergenCode.LACTEOS,
        AllergenCode.SOYA,
      ]);

      expect(repo.save.mock.calls[0][0].alergias).toEqual([
        AllergenCode.LACTEOS,
        AllergenCode.SOYA,
      ]);
      expect(perfil).not.toHaveProperty("password");
    });

    it.each(["perfil", "actualizarAlergias"] as const)(
      "%s responde 404 si el usuario ya no existe",
      async (metodo) => {
        repo.findOne.mockResolvedValue(null);

        await expect(service[metodo]("u1", [])).rejects.toBeInstanceOf(
          NotFoundException,
        );
      },
    );
  });

  describe("buscarPorId y listar", () => {
    it("buscarPorId devuelve el usuario o null", async () => {
      repo.findOne
        .mockResolvedValueOnce({ id: "u1" })
        .mockResolvedValueOnce(null);

      await expect(service.buscarPorId("u1")).resolves.toEqual({ id: "u1" });
      await expect(service.buscarPorId("u2")).resolves.toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: "u1" } });
    });

    it("listar devuelve id, nombre, correo y rol, sin password ni alergias", async () => {
      repo.find.mockResolvedValue([
        {
          id: "u1",
          nombre: "Ana",
          correo: "ana@correo.cl",
          password: "$2b$10$hash",
          alergias: [AllergenCode.MANI],
          rol: Rol.ADMINISTRADOR,
        },
      ]);

      const lista = await service.listar();

      expect(repo.find).toHaveBeenCalledWith({
        order: { nombre: "ASC", correo: "ASC" },
      });
      expect(lista).toEqual([
        {
          id: "u1",
          nombre: "Ana",
          correo: "ana@correo.cl",
          rol: "administrador",
        },
      ]);
    });
  });
});
