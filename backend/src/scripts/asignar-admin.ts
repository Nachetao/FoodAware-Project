/**
 * Asigna o quita el rol de administrador a un usuario ya registrado. Es la
 * única forma de crear administradores: la API no permite cambiar roles.
 *
 *   npm run admin:asignar -- ana@correo.cl            (pasa a administrador)
 *   npm run admin:asignar -- ana@correo.cl --quitar   (vuelve a usuario)
 *
 * Se conecta con las variables DB_* (del entorno o de ../.env), igual que las
 * migraciones; DB_SSL=true para una base que exige TLS. Ya compilado:
 * node dist/scripts/asignar-admin.js <correo> [--quitar].
 */
import dataSource from "../data-source";
import { User } from "../users/user.entity";
import { USO, cambiarRol, leerArgumentos, mensajeResultado } from "./rol-admin";

async function main(): Promise<void> {
  const pedido = leerArgumentos(process.argv.slice(2));
  if (!pedido) {
    console.error(USO);
    process.exitCode = 2;
    return;
  }

  await dataSource.initialize();
  try {
    const resultado = await cambiarRol(dataSource.getRepository(User), pedido);
    console.log(mensajeResultado(resultado, pedido));
    if (resultado === "no_existe") {
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: Error) => {
  console.error(`No se pudo cambiar el rol: ${error.message}`);
  process.exitCode = 1;
});
