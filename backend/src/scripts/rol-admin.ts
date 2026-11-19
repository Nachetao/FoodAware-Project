import { Repository } from "typeorm";
import { Rol } from "../users/rol";
import { User } from "../users/user.entity";

export const USO =
  "Uso: npm run admin:asignar -- <correo> [--quitar]\n" +
  "  Sin --quitar, el usuario pasa a administrador; con --quitar, vuelve a usuario.\n" +
  "  El usuario ya debe estar registrado.";

export interface PedidoRol {
  correo: string;
  rol: Rol;
}

export type ResultadoRol = "cambiado" | "sin_cambios" | "no_existe";

/** Lee "<correo> [--quitar]"; null si los argumentos no tienen esa forma. */
export function leerArgumentos(args: readonly string[]): PedidoRol | null {
  const opciones = args.filter((a) => a.startsWith("--"));
  const correos = args.filter((a) => !a.startsWith("--"));
  if (
    correos.length !== 1 ||
    !correos[0].includes("@") ||
    opciones.some((o) => o !== "--quitar")
  ) {
    return null;
  }
  return {
    correo: correos[0].trim(),
    rol: opciones.includes("--quitar") ? Rol.USUARIO : Rol.ADMINISTRADOR,
  };
}

/** Cambia el rol de un usuario existente, buscándolo por correo. */
export async function cambiarRol(
  repositorio: Pick<Repository<User>, "findOne" | "update">,
  { correo, rol }: PedidoRol,
): Promise<ResultadoRol> {
  const usuario = await repositorio.findOne({ where: { correo } });
  if (!usuario) {
    return "no_existe";
  }
  if (usuario.rol === rol) {
    return "sin_cambios";
  }
  await repositorio.update({ id: usuario.id }, { rol });
  return "cambiado";
}

export function mensajeResultado(
  resultado: ResultadoRol,
  { correo, rol }: PedidoRol,
): string {
  switch (resultado) {
    case "cambiado":
      return `${correo} ahora tiene el rol "${rol}". Debe volver a iniciar sesión.`;
    case "sin_cambios":
      return `${correo} ya tenía el rol "${rol}"; no se cambió nada.`;
    case "no_existe":
      return `No hay ningún usuario registrado con el correo ${correo}.`;
  }
}
