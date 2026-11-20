// Se carga después de test/integracion/entorno.ts, en cada archivo de prueba.
import { exigirBaseDePrueba } from "./conexion";

// Última barrera: si DB_NAME no es la base que creó globalSetup (por ejemplo,
// quedó el foodaware_db del .env), la suite se detiene antes de conectarse.
exigirBaseDePrueba(process.env.DB_NAME);
if (process.env.DB_NAME !== process.env.PRUEBA_DB_CREADA) {
  throw new Error("DB_NAME no es la base creada por esta ejecución.");
}

// Varias pruebas inician sesión y registran usuarios seguidos; el límite de
// peticiones ya se prueba en la integración.
process.env.LIMITE_LOGIN_POR_MINUTO = "1000";
process.env.LIMITE_PUBLICO_POR_MINUTO = "1000";
