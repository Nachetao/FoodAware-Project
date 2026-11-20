import { Client } from "pg";
import {
  BASE_MANTENIMIENTO,
  PREFIJO_BASE,
  exigirBaseDePrueba,
  servidorDePrueba,
} from "./conexion";

/**
 * globalSetup: crea una base vacía y propia de esta ejecución
 * (foodaware_prueba_<marca de tiempo>_<pid>). La app de prueba le aplica
 * las migraciones al iniciar, igual que en producción.
 */
export default async function prepararBase(): Promise<void> {
  const servidor = servidorDePrueba();
  const nombre = exigirBaseDePrueba(
    `${PREFIJO_BASE}${Date.now()}_${process.pid}`,
  );

  const cliente = new Client({ ...servidor, database: BASE_MANTENIMIENTO() });
  try {
    await cliente.connect();
  } catch (error) {
    throw new Error(
      `No se pudo conectar a PostgreSQL en ${servidor.host}:${servidor.port} ` +
        `(¿está levantado "docker compose up -d db"?): ${(error as Error).message}`,
    );
  }
  try {
    // El nombre ya pasó la validación del prefijo: no hay comillas que escapar.
    await cliente.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await cliente.end();
  }

  // Lo leen la app de prueba (ConfigModule da prioridad a process.env sobre
  // el .env) y globalTeardown.
  Object.assign(process.env, {
    DB_HOST: servidor.host,
    DB_PORT: String(servidor.port),
    DB_USER: servidor.user,
    DB_PASSWORD: servidor.password,
    DB_NAME: nombre,
    PRUEBA_DB_CREADA: nombre,
  });
  console.log(`\nBase de prueba creada: ${nombre}`);
}
