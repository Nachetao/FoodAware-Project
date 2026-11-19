/**
 * true si el usuario pidió reducir el movimiento (ajuste del sistema
 * operativo). Se usa al iniciar Ionic para desactivar sus animaciones.
 */
export function movimientoReducido(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
