import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Rol } from "../users/rol";
import { RolesGuard } from "./roles.guard";

describe("RolesGuard", () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  const contexto = (user: unknown) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it("deja pasar una ruta sin @Roles, haya o no usuario", () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(contexto(null))).toBe(true);
    expect(guard.canActivate(contexto({ rol: Rol.USUARIO }))).toBe(true);
  });

  it("deja pasar a un usuario con uno de los roles pedidos", () => {
    reflector.getAllAndOverride.mockReturnValue([Rol.ADMINISTRADOR]);

    expect(guard.canActivate(contexto({ rol: Rol.ADMINISTRADOR }))).toBe(true);
  });

  it("responde 403 a un usuario con otro rol", () => {
    reflector.getAllAndOverride.mockReturnValue([Rol.ADMINISTRADOR]);

    expect(() => guard.canActivate(contexto({ rol: Rol.USUARIO }))).toThrow(
      ForbiddenException,
    );
  });

  it("responde 401 si la ruta pide un rol y no hay usuario", () => {
    reflector.getAllAndOverride.mockReturnValue([Rol.ADMINISTRADOR]);

    expect(() => guard.canActivate(contexto(null))).toThrow(
      UnauthorizedException,
    );
  });
});
