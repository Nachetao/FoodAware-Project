import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Rol } from "../users/rol";
import { Roles } from "./decoradores";
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

// Con el Reflector real: @Roles se lee desde la clase (como en
// UsuariosAdminController) y desde el método (como en FoodsController).
@Roles(Rol.ADMINISTRADOR)
class ControladorSoloAdmin {
  listar() {}

  @Roles(Rol.USUARIO, Rol.ADMINISTRADOR)
  abiertaATodos() {}

  @Roles()
  sinRoles() {}
}

class ControladorConSesion {
  perfil() {}

  @Roles(Rol.ADMINISTRADOR)
  soloAdmin() {}
}

describe("RolesGuard con el Reflector real", () => {
  const guard = new RolesGuard(new Reflector());
  const admin = { rol: Rol.ADMINISTRADOR };
  const usuario = { rol: Rol.USUARIO };

  const permite = (
    clase: { prototype: object },
    metodo: string,
    user: unknown,
  ) =>
    guard.canActivate({
      getHandler: () => (clase.prototype as Record<string, unknown>)[metodo],
      getClass: () => clase,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext);

  it("@Roles en la clase aplica a los métodos sin decorador", () => {
    expect(permite(ControladorSoloAdmin, "listar", admin)).toBe(true);
    expect(() => permite(ControladorSoloAdmin, "listar", usuario)).toThrow(
      ForbiddenException,
    );
  });

  it("@Roles en el método reemplaza al de la clase", () => {
    expect(permite(ControladorSoloAdmin, "abiertaATodos", usuario)).toBe(true);
  });

  it("@Roles() sin roles deja pasar a cualquier usuario", () => {
    expect(permite(ControladorSoloAdmin, "sinRoles", usuario)).toBe(true);
  });

  it("@Roles en un método no afecta a los demás del controlador", () => {
    expect(permite(ControladorConSesion, "perfil", usuario)).toBe(true);
    expect(() => permite(ControladorConSesion, "soloAdmin", usuario)).toThrow(
      ForbiddenException,
    );
    expect(permite(ControladorConSesion, "soloAdmin", admin)).toBe(true);
  });
});
