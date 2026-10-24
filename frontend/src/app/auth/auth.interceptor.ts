import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Agrega Authorization: Bearer a las peticiones al backend (solo a él, para
 * no filtrar el token a otros dominios). Un 401 con token cierra la sesión:
 * el token expiró o ya no es válido.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const alBackend = req.url.startsWith(`${environment.apiUrl}/`);
  const peticion =
    token && alBackend
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(peticion).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && token && alBackend) {
        auth.cerrarSesion();
      }
      return throwError(() => error);
    }),
  );
};
