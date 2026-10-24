import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, switchMap, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AllergenCode } from '../products/models/enums';
import { aErrorApi } from '../products/products.service';

const CLAVE_TOKEN = 'foodaware.token';

export interface Usuario {
  id: string;
  nombre: string;
  correo: string;
  alergias: AllergenCode[];
}

export interface DatosRegistro {
  nombre: string;
  correo: string;
  password: string;
  alergias: AllergenCode[];
}

// localStorage puede no existir o fallar (modo privado, almacenamiento bloqueado).
function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null;
  }
}

function escribirToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(CLAVE_TOKEN, token);
    } else {
      localStorage.removeItem(CLAVE_TOKEN);
    }
  } catch {
    // Sin almacenamiento la sesión dura solo mientras la página esté abierta.
  }
}

/** Sesión del usuario: token JWT y perfil. Los errores llegan como ErrorApi. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/api`;

  readonly token = signal<string | null>(leerToken());
  readonly usuario = signal<Usuario | null>(null);
  readonly autenticado = computed(() => this.token() !== null);

  constructor() {
    // Con un token guardado se recupera el perfil (si expiró, se cierra la sesión).
    if (this.token()) {
      this.cargarPerfil().subscribe({ error: () => undefined });
    }
  }

  login(correo: string, password: string): Observable<Usuario> {
    return this.http
      .post<{ access_token: string }>(`${this.api}/auth/login`, { correo, password })
      .pipe(
        catchError((error: HttpErrorResponse) =>
          throwError(() =>
            error.status === 401
              ? { ...aErrorApi(error), mensaje: 'Correo o contraseña incorrectos.' }
              : aErrorApi(error),
          ),
        ),
        tap(({ access_token }) => this.guardarToken(access_token)),
        switchMap(() => this.cargarPerfil()),
      );
  }

  /** Registra al usuario e inicia su sesión. */
  registrar(datos: DatosRegistro): Observable<Usuario> {
    return this.http.post(`${this.api}/users`, datos).pipe(
      catchError((error: HttpErrorResponse) => throwError(() => aErrorApi(error))),
      switchMap(() => this.login(datos.correo, datos.password)),
    );
  }

  cargarPerfil(): Observable<Usuario> {
    return this.http.get<Usuario>(`${this.api}/usuarios/me`).pipe(
      tap((usuario) => this.usuario.set(usuario)),
      catchError((error: HttpErrorResponse) => throwError(() => aErrorApi(error))),
    );
  }

  actualizarAlergias(alergias: AllergenCode[]): Observable<Usuario> {
    return this.http
      .put<Usuario>(`${this.api}/usuarios/me/alergias`, { alergias })
      .pipe(
        tap((usuario) => this.usuario.set(usuario)),
        catchError((error: HttpErrorResponse) => throwError(() => aErrorApi(error))),
      );
  }

  cerrarSesion(): void {
    this.guardarToken(null);
    this.usuario.set(null);
  }

  private guardarToken(token: string | null): void {
    this.token.set(token);
    escribirToken(token);
  }
}
