import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { AppModule } from "../../src/app.module";
import { configurarApp } from "../../src/config/configurar-app";
import { exigirBaseDePrueba } from "./conexion";

/**
 * Levanta el AppModule completo con TypeORM contra la base de prueba real
 * (migraciones incluidas, como en el arranque de producción). Solo FastAPI es
 * un servidor falso.
 */
export async function crearAppPostgres(pythonApiUrl: string) {
  exigirBaseDePrueba(process.env.DB_NAME);
  process.env.PYTHON_API_URL = pythonApiUrl;

  const modulo = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app: INestApplication = modulo.createNestApplication({
    bufferLogs: true,
  });
  configurarApp(app);
  await app.init();

  const base = app.get(DataSource);
  exigirBaseDePrueba(base.options.database);
  return { app, base };
}

/** Deja las tablas de datos vacías entre pruebas (no toca las migraciones). */
export async function vaciarTablas(base: DataSource): Promise<void> {
  exigirBaseDePrueba(base.options.database);
  await base.query("TRUNCATE users, products, foods");
}
