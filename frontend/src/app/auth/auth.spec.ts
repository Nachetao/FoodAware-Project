import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService, Usuario, rolDelToken } from './auth.service';
import { authInterceptor } from './auth.interceptor';
import { authGuard } from './auth.guard';
import { adminGuard } from './admin.guard';

const API = `${environment.apiUrl}/api`;

/** JWT con el payload en base64url (UTF-8), como lo firma el backend. */
function jwt(payload: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...bytes));
  return `cabecera.${base64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.firma`;
}
const TOKEN_USUARIO = jwt({ sub: 'u1', correo: 'ana@correo.cl', rol: 'usuario' });
const TOKEN_ADMIN = jwt({ sub: 'u2', correo: 'ñandú@correo.cl', rol: 'administrador' });
const ANA: Usuario = {
  id: 'u1',
  nombre: 'Ana',
  correo: 'ana@correo.cl',
  alergias: ['mani'],
  dietas: [],
  modo_estricto: false,
  rol: 'usuario',
};

describe('Autenticación', () => {
  let auth: AuthService;
  let http: HttpClient;
  let httpMock: HttpTestingController;

  function configurar() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    localStorage.clear();
    configurar();
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  async function iniciarSesion() {
    const resultado = firstValueFrom(auth.login('ana@correo.cl', 'secreta'));
    httpMock.expectOne(`${API}/auth/login`).flush({ access_token: 'jwt-1' });
    httpMock.expectOne(`${API}/usuarios/me`).flush(ANA);
    return resultado;
  }

  describe('AuthService', () => {
    it('login guarda el token y carga el perfil', async () => {
      expect(auth.autenticado()).toBe(false);

      await expect(iniciarSesion()).resolves.toEqual(ANA);

      expect(auth.token()).toBe('jwt-1');
      expect(auth.usuario()).toEqual(ANA);
      expect(localStorage.getItem('foodaware.token')).toBe('jwt-1');
    });

    it('un 401 en el login se traduce a "Correo o contraseña incorrectos."', async () => {
      const resultado = firstValueFrom(auth.login('ana@correo.cl', 'mala'));
      httpMock
        .expectOne(`${API}/auth/login`)
        .flush({ statusCode: 401, message: 'Credenciales inválidas' }, { status: 401, statusText: 'Unauthorized' });

      await expect(resultado).rejects.toMatchObject({ mensaje: 'Correo o contraseña incorrectos.' });
      expect(auth.autenticado()).toBe(false);
    });

    it('cerrarSesion borra el token y el usuario', async () => {
      await iniciarSesion();

      auth.cerrarSesion();

      expect(auth.autenticado()).toBe(false);
      expect(auth.usuario()).toBeNull();
      expect(localStorage.getItem('foodaware.token')).toBeNull();
    });

    it('funciona aunque localStorage falle', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('almacenamiento bloqueado');
      });

      await iniciarSesion();

      expect(auth.autenticado()).toBe(true);
    });
  });

  describe('rol del token', () => {
    it.each([
      ['un token de usuario', TOKEN_USUARIO, 'usuario'],
      ['un token de administrador (con UTF-8 en el payload)', TOKEN_ADMIN, 'administrador'],
      ['un token sin rol', jwt({ sub: 'u1' }), null],
      ['un rol desconocido', jwt({ rol: 'superusuario' }), null],
      ['un token que no es un JWT', 'jwt-1', null],
      ['un payload que no es JSON', 'a.no-es-json.b', null],
      ['sin token', null, null],
    ])('rolDelToken con %s', (_caso, token, rol) => {
      expect(rolDelToken(token)).toBe(rol);
    });

    it('esAdmin sigue al token de la sesión', () => {
      expect(auth.esAdmin()).toBe(false);

      auth.token.set(TOKEN_ADMIN);
      expect(auth.rol()).toBe('administrador');
      expect(auth.esAdmin()).toBe(true);

      auth.token.set(TOKEN_USUARIO);
      expect(auth.esAdmin()).toBe(false);

      auth.cerrarSesion();
      expect(auth.rol()).toBeNull();
    });
  });

  describe('authInterceptor', () => {
    it('agrega el Bearer a las peticiones al backend con sesión', async () => {
      await iniciarSesion();

      http.get(`${API}/products/search`).subscribe();

      const req = httpMock.expectOne(`${API}/products/search`);
      expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-1');
      req.flush({});
    });

    it('no agrega el token sin sesión ni a otros dominios', async () => {
      http.get(`${API}/health`).subscribe();
      expect(httpMock.expectOne(`${API}/health`).request.headers.has('Authorization')).toBe(false);

      await iniciarSesion();
      http.get('https://images.openfoodfacts.org/x.json').subscribe();
      expect(
        httpMock.expectOne('https://images.openfoodfacts.org/x.json').request.headers.has('Authorization'),
      ).toBe(false);
    });

    it('un 401 con token cierra la sesión', async () => {
      await iniciarSesion();

      http.get(`${API}/usuarios/me`).subscribe({ error: () => undefined });
      httpMock.expectOne(`${API}/usuarios/me`).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(auth.autenticado()).toBe(false);
    });
  });

  describe('authGuard', () => {
    const ejecutar = () =>
      TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/perfil' } as never));

    it('deja pasar con sesión', async () => {
      await iniciarSesion();
      expect(ejecutar()).toBe(true);
    });

    it('sin sesión redirige a /login con la ruta de vuelta', () => {
      const resultado = ejecutar() as UrlTree;
      expect(TestBed.inject(Router).serializeUrl(resultado)).toBe('/login?volver=%2Fperfil');
    });
  });

  describe('adminGuard', () => {
    const ejecutar = () =>
      TestBed.runInInjectionContext(() => adminGuard({} as never, { url: '/admin' } as never));
    const url = (resultado: unknown) => TestBed.inject(Router).serializeUrl(resultado as UrlTree);

    it('deja pasar a un administrador', () => {
      auth.token.set(TOKEN_ADMIN);
      expect(ejecutar()).toBe(true);
    });

    it('a un usuario sin ese rol lo manda a /home', () => {
      auth.token.set(TOKEN_USUARIO);
      expect(url(ejecutar())).toBe('/home');
    });

    it('sin sesión redirige a /login con la ruta de vuelta', () => {
      expect(url(ejecutar())).toBe('/login?volver=%2Fadmin');
    });
  });
});
