import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "dotenv";

/** Servidor y credenciales (sin base): lo que recibe pg.Client más database. */
export interface ServidorPostgres {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * Las pruebas solo crean, usan y borran bases con este prefijo. Nunca se
 * conectan a la base de la aplicación (DB_NAME del .env, foodaware_db).
 */
export const PREFIJO_BASE = "foodaware_prueba_";

const NOMBRE_VALIDO = /^foodaware_prueba_[a-z0-9_]+$/;

export function esBaseDePrueba(nombre: unknown): nombre is string {
  return typeof nombre === "string" && NOMBRE_VALIDO.test(nombre);
}

export function exigirBaseDePrueba(nombre: unknown): string {
  if (!esBaseDePrueba(nombre)) {
    throw new Error(
      `Las pruebas con PostgreSQL solo usan bases ${PREFIJO_BASE}*; se recibió "${String(nombre)}".`,
    );
  }
  return nombre;
}

/**
 * Servidor PostgreSQL de las pruebas. Por defecto, el servicio db de docker
 * compose publicado en localhost:5433, con DB_USER y DB_PASSWORD del .env de
 * la raíz. En CI (u otro servidor) se usan las variables PRUEBA_DB_*.
 */
export function servidorDePrueba(): ServidorPostgres {
  const archivo = resolve(__dirname, "../../../.env");
  const dotenv = existsSync(archivo) ? parse(readFileSync(archivo)) : {};
  const leer = (prueba: string, app: string) =>
    process.env[prueba] || process.env[app] || dotenv[app];

  const user = leer("PRUEBA_DB_USER", "DB_USER");
  const password = leer("PRUEBA_DB_PASSWORD", "DB_PASSWORD");
  if (!user || !password) {
    throw new Error(
      "Faltan las credenciales de PostgreSQL: define PRUEBA_DB_USER y PRUEBA_DB_PASSWORD, o DB_USER y DB_PASSWORD en el .env de la raíz.",
    );
  }
  return {
    host: process.env.PRUEBA_DB_HOST || "localhost",
    port: Number(process.env.PRUEBA_DB_PORT || 5433),
    user,
    password,
  };
}

/** Base de mantenimiento desde la que se crea y se borra la de prueba. */
export const BASE_MANTENIMIENTO = () =>
  process.env.PRUEBA_DB_MANTENIMIENTO || "postgres";
