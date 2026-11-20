import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { ES_PUBLICA, ROLES } from "./decoradores";
import { FoodsController } from "../foods/foods.controller";
import { IaController } from "../ia/ia.controller";
import { MetricasController } from "../metricas/metricas.controller";
import { ProductsController } from "../products/products.controller";
import { SaludController } from "../salud/salud.controller";
import { Rol } from "../users/rol";
import { UsersController } from "../users/users.controller";
import { UsuariosAdminController } from "../users/usuarios-admin.controller";
import { UsuariosController } from "../users/usuarios.controller";

// AuthService importa @nestjs/jwt (ESM), que la configuración unitaria de
// Jest no carga. Aquí solo se leen los decoradores de los controladores.
jest.mock("./auth.service", () => ({ AuthService: class {} }));

type Acceso = "pública" | "con sesión" | "solo administrador" | "inconsistente";

const CONTROLADORES = [
  AuthController,
  FoodsController,
  IaController,
  MetricasController,
  ProductsController,
  SaludController,
  UsersController,
  UsuariosAdminController,
  UsuariosController,
];

/**
 * Acceso de cada ruta de la API, leído con el mismo Reflector y las mismas
 * claves que JwtAuthGuard (@Public) y RolesGuard (@Roles).
 */
function inventario(): Record<string, Acceso> {
  const reflector = new Reflector();
  const rutas: Record<string, Acceso> = {};
  const unir = (...partes: string[]) =>
    "/" +
    ["api", ...partes]
      .flatMap((p) => p.split("/"))
      .filter(Boolean)
      .join("/");

  for (const controlador of CONTROLADORES) {
    const base: string = Reflect.getMetadata(PATH_METADATA, controlador);
    const prototipo = controlador.prototype as unknown as Record<
      string,
      unknown
    >;
    for (const nombre of Object.getOwnPropertyNames(prototipo)) {
      const handler = prototipo[nombre];
      if (nombre === "constructor" || typeof handler !== "function") continue;
      const metodo: RequestMethod | undefined = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      );
      if (metodo === undefined) continue;
      const ruta: string = Reflect.getMetadata(PATH_METADATA, handler);

      const destinos = [handler, controlador];
      const publica = reflector.getAllAndOverride<boolean>(
        ES_PUBLICA,
        destinos,
      );
      const roles =
        reflector.getAllAndOverride<Rol[] | undefined>(ROLES, destinos) ?? [];
      let acceso: Acceso = publica ? "pública" : "con sesión";
      if (roles.length > 0) {
        acceso =
          !publica && roles.length === 1 && roles[0] === Rol.ADMINISTRADOR
            ? "solo administrador"
            : "inconsistente";
      }
      rutas[`${RequestMethod[metodo]} ${unir(base, ruta)}`] = acceso;
    }
  }
  return rutas;
}

describe("Inventario de rutas y su acceso", () => {
  // Al agregar o cambiar un endpoint, esta tabla obliga a decidir quién puede
  // usarlo. Las de administración se prueban también en la integración
  // (401 sin token, 403 a un usuario y 200 a un administrador).
  const ESPERADO: Record<string, Acceso> = {
    "POST /api/auth/login": "pública",
    "POST /api/users": "pública",
    "GET /api/health": "pública",
    "GET /api/metricas/calidad": "pública",
    "GET /api/metricas/evaluacion": "pública",
    "GET /api/ingesta/ultima": "pública",
    "GET /api/products/search": "pública",
    "GET /api/products/:codigo_barras": "pública",
    "POST /api/food/analizar": "pública",
    "GET /api/products/search/personalizada": "con sesión",
    "GET /api/products/compatibles": "con sesión",
    "GET /api/products/:codigo_barras/compatibilidad": "con sesión",
    "GET /api/usuarios/me": "con sesión",
    "PATCH /api/usuarios/me": "con sesión",
    "DELETE /api/usuarios/me": "con sesión",
    "PUT /api/usuarios/me/alergias": "con sesión",
    "GET /api/usuarios": "solo administrador",
    "GET /api/food": "solo administrador",
  };

  it("cada ruta tiene el acceso esperado y no hay rutas sin clasificar", () => {
    expect(inventario()).toEqual(ESPERADO);
  });

  it("las rutas de administración son exactamente GET /api/usuarios y GET /api/food", () => {
    const admin = Object.entries(inventario())
      .filter(([, acceso]) => acceso === "solo administrador")
      .map(([ruta]) => ruta)
      .sort();

    expect(admin).toEqual(["GET /api/food", "GET /api/usuarios"]);
  });
});
