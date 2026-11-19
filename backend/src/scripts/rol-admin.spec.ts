import { Rol } from "../users/rol";
import { User } from "../users/user.entity";
import { cambiarRol, leerArgumentos, mensajeResultado } from "./rol-admin";

describe("script admin:asignar", () => {
  describe("leerArgumentos", () => {
    it("un correo asigna administrador", () => {
      expect(leerArgumentos(["ana@correo.cl"])).toEqual({
        correo: "ana@correo.cl",
        rol: Rol.ADMINISTRADOR,
      });
    });

    it("--quitar devuelve el rol usuario", () => {
      expect(leerArgumentos(["--quitar", "ana@correo.cl"])).toEqual({
        correo: "ana@correo.cl",
        rol: Rol.USUARIO,
      });
    });

    it.each([
      ["sin argumentos", []],
      ["sin @", ["ana"]],
      ["dos correos", ["ana@correo.cl", "bea@correo.cl"]],
      ["una opción desconocida", ["ana@correo.cl", "--rol=administrador"]],
    ])("rechaza %s", (_caso, args) => {
      expect(leerArgumentos(args)).toBeNull();
    });
  });

  describe("cambiarRol", () => {
    const ana = { id: "u1", correo: "ana@correo.cl", rol: Rol.USUARIO } as User;
    let repo: { findOne: jest.Mock; update: jest.Mock };

    beforeEach(() => {
      repo = {
        findOne: jest.fn().mockResolvedValue(ana),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
    });

    it("cambia el rol de un usuario existente, buscándolo por correo", async () => {
      const resultado = await cambiarRol(repo, {
        correo: "ana@correo.cl",
        rol: Rol.ADMINISTRADOR,
      });

      expect(resultado).toBe("cambiado");
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { correo: "ana@correo.cl" },
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: "u1" },
        { rol: Rol.ADMINISTRADOR },
      );
    });

    it("no escribe si ya tenía ese rol", async () => {
      const resultado = await cambiarRol(repo, {
        correo: "ana@correo.cl",
        rol: Rol.USUARIO,
      });

      expect(resultado).toBe("sin_cambios");
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("no crea usuarios: avisa si el correo no está registrado", async () => {
      repo.findOne.mockResolvedValue(null);

      const resultado = await cambiarRol(repo, {
        correo: "nadie@correo.cl",
        rol: Rol.ADMINISTRADOR,
      });

      expect(resultado).toBe("no_existe");
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  it("el mensaje recuerda volver a iniciar sesión tras el cambio", () => {
    expect(
      mensajeResultado("cambiado", {
        correo: "ana@correo.cl",
        rol: Rol.ADMINISTRADOR,
      }),
    ).toBe(
      'ana@correo.cl ahora tiene el rol "administrador". Debe volver a iniciar sesión.',
    );
  });
});
