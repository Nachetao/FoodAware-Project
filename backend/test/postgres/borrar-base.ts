import { Client } from "pg";
import {
  BASE_MANTENIMIENTO,
  exigirBaseDePrueba,
  servidorDePrueba,
} from "./conexion";

/**
 * globalTeardown: borra solo la base que creó preparar-base.ts en esta
 * ejecución. Se niega a borrar cualquier nombre sin el prefijo de prueba.
 */
export default async function borrarBase(): Promise<void> {
  const creada = process.env.PRUEBA_DB_CREADA;
  if (!creada) return;
  const nombre = exigirBaseDePrueba(creada);

  const cliente = new Client({
    ...servidorDePrueba(),
    database: BASE_MANTENIMIENTO(),
  });
  await cliente.connect();
  try {
    // WITH (FORCE): corta conexiones que hayan quedado abiertas (PostgreSQL 13+).
    await cliente.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
  } finally {
    await cliente.end();
  }
  console.log(`Base de prueba borrada: ${nombre}`);
}
