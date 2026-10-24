import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Rutas privadas: sin sesión redirige a /login y recuerda a dónde volver. */
export const authGuard: CanActivateFn = (_ruta, estado) =>
  inject(AuthService).autenticado() ||
  inject(Router).createUrlTree(['/login'], { queryParams: { volver: estado.url } });
