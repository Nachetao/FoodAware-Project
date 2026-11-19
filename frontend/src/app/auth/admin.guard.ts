import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Rutas de administración: sin sesión redirige a /login (y recuerda a dónde
 * volver); con sesión de usuario, a /home. El backend responde 403 igual.
 */
export const adminGuard: CanActivateFn = (_ruta, estado) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.autenticado()) {
    return router.createUrlTree(['/login'], { queryParams: { volver: estado.url } });
  }
  return auth.esAdmin() || router.createUrlTree(['/home']);
};
