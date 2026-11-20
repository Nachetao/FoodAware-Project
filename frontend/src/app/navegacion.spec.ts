import { DebugElement } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular/lazy';

import { AdminPage } from './admin/admin.page';
import { routes } from './app-routing.module';
import { AuthService } from './auth/auth.service';
import { PerfilPage } from './cuenta/perfil.page';
import { HomePage } from './home/home.page';

/** JWT con el payload en base64url, como lo firma el backend (sin verificar la firma). */
function jwt(payload: object): string {
  const base64 = btoa(JSON.stringify(payload));
  return `cabecera.${base64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.firma`;
}
const TOKEN_USUARIO = jwt({ sub: 'u1', correo: 'ana@correo.cl', rol: 'usuario' });
const TOKEN_ADMIN = jwt({ sub: 'u2', correo: 'admin@correo.cl', rol: 'administrador' });

/**
 * Navegación con la tabla de rutas real de la app (app-routing.module.ts y las
 * rutas de CuentaModule), sus guards y sus módulos lazy. El backend no
 * responde: las peticiones quedan pendientes en HttpTestingController.
 */
describe('Navegación con las rutas reales', () => {
  let harness: RouterTestingHarness;
  let auth: AuthService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [IonicModule.forRoot()],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => localStorage.clear());

  const url = () => TestBed.inject(Router).url;
  const ir = (ruta: string) => harness.navigateByUrl(ruta);
  // Ionic quita aria-label del DOM al hidratar ion-button: se lee el atributo
  // estático de la plantilla con DebugElement.attributes.
  const accionesBarra = () => {
    harness.detectChanges();
    return harness.fixture.debugElement
      .queryAll(By.css('app-barra-superior ion-buttons[slot="end"] ion-button'))
      .map((de: DebugElement) => de.attributes['aria-label']);
  };

  describe('sin sesión', () => {
    it('la raíz redirige a /home', async () => {
      const pagina = await ir('/');

      expect(url()).toBe('/home');
      expect(pagina).toBeInstanceOf(HomePage);
    });

    it.each(['/home', '/busqueda', '/metricas', '/login', '/registro'])(
      '%s es pública',
      async (ruta) => {
        await ir(ruta);

        expect(url()).toBe(ruta);
      },
    );

    it.each([
      ['/perfil', '/login?volver=%2Fperfil'],
      ['/admin', '/login?volver=%2Fadmin'],
    ])('%s redirige al login y recuerda la ruta (%s)', async (ruta, destino) => {
      await ir(ruta);

      expect(url()).toBe(destino);
    });

    it('la barra superior ofrece "Ingresar" y no "Administración"', async () => {
      await ir('/home');

      expect(accionesBarra()).toEqual(['Buscar productos', 'Ver métricas', 'Ingresar']);
    });
  });

  describe('con sesión de usuario', () => {
    beforeEach(() => auth.token.set(TOKEN_USUARIO));

    it('entra a /perfil', async () => {
      const pagina = await ir('/perfil');

      expect(url()).toBe('/perfil');
      expect(pagina).toBeInstanceOf(PerfilPage);
    });

    it('/admin lo manda a /home sin mostrar la administración', async () => {
      const pagina = await ir('/admin');

      expect(url()).toBe('/home');
      expect(pagina).toBeInstanceOf(HomePage);
    });

    it('la barra superior muestra "Mi perfil" y no "Administración"', async () => {
      await ir('/home');

      expect(accionesBarra()).toEqual(['Buscar productos', 'Ver métricas', 'Mi perfil']);
    });

    it('al cerrar la sesión, /perfil vuelve a pedir el login', async () => {
      await ir('/perfil');
      auth.cerrarSesion();
      // El Router ignora navegar a la misma URL: se vuelve desde otra página.
      await ir('/home');

      await ir('/perfil');

      expect(url()).toBe('/login?volver=%2Fperfil');
    });
  });

  describe('con sesión de administrador', () => {
    beforeEach(() => auth.token.set(TOKEN_ADMIN));

    it('entra a /admin', async () => {
      const pagina = await ir('/admin');

      expect(url()).toBe('/admin');
      expect(pagina).toBeInstanceOf(AdminPage);
    });

    it('la barra superior agrega "Administración" y lleva a /admin', async () => {
      await ir('/home');
      expect(accionesBarra()).toEqual([
        'Buscar productos',
        'Ver métricas',
        'Administración',
        'Mi perfil',
      ]);

      const boton = harness.fixture.debugElement
        .queryAll(By.css('app-barra-superior ion-button'))
        .find((de) => de.attributes['aria-label'] === 'Administración');
      (boton!.nativeElement as HTMLElement).click();
      await harness.fixture.whenStable();

      expect(url()).toBe('/admin');
      expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(AdminPage);
    });

    it('si el token cambia a uno de usuario, /admin deja de estar disponible', async () => {
      await ir('/admin');
      auth.token.set(TOKEN_USUARIO);
      await ir('/busqueda');

      await ir('/admin');

      expect(url()).toBe('/home');
    });
  });
});
