/**
 * Rol del usuario. Todo registro nace como USUARIO; ADMINISTRADOR solo se
 * asigna con el script admin:asignar (src/scripts/asignar-admin.ts), nunca
 * desde la API.
 */
export enum Rol {
  USUARIO = "usuario",
  ADMINISTRADOR = "administrador",
}
