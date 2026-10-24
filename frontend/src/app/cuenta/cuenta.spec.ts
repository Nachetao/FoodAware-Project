import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { of, throwError } from 'rxjs';
import { AuthService, Usuario } from '../auth/auth.service';
import { CuentaModule } from './cuenta.module';
import { LoginPage } from './login.page';
import { PerfilPage } from './perfil.page';
import { RegistroPage } from './registro.page';

const ANA: Usuario = { id: 'u1', nombre: 'Ana', correo: 'ana@correo.cl', alergias: ['mani'] };

describe('Cuenta: login, registro y perfil', () => {
  let auth: {
    usuario: ReturnType<typeof signal<Usuario | null>>;
    login: ReturnType<typeof vi.fn>;
    registrar: ReturnType<typeof vi.fn>;
    cargarPerfil: ReturnType<typeof vi.fn>;
    actualizarAlergias: ReturnType<typeof vi.fn>;
    cerrarSesion: ReturnType<typeof vi.fn>;
  };
  let navegar: ReturnType<typeof vi.spyOn>;

  async function crear<T>(pagina: Type<T>, volver?: string): Promise<ComponentFixture<T>> {
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), CuentaModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(volver ? { volver } : {}) } },
        },
      ],
    }).compileComponents();
    navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(pagina);
    fixture.detectChanges();
    return fixture;
  }

  const html = (f: ComponentFixture<unknown>) => {
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    auth = {
      usuario: signal<Usuario | null>(ANA),
      login: vi.fn(() => of(ANA)),
      registrar: vi.fn(() => of(ANA)),
      cargarPerfil: vi.fn(() => of(ANA)),
      actualizarAlergias: vi.fn((alergias) => of({ ...ANA, alergias })),
      cerrarSesion: vi.fn(),
    };
  });

  describe('LoginPage', () => {
    it('ingresa y vuelve a la ruta pedida', async () => {
      const f = await crear(LoginPage, '/perfil');
      f.componentInstance.correo = ' ana@correo.cl ';
      f.componentInstance.password = 'secreta';

      f.componentInstance.ingresar();

      expect(auth.login).toHaveBeenCalledWith('ana@correo.cl', 'secreta');
      expect(navegar).toHaveBeenCalledWith('/perfil');
    });

    it('sin ruta de vuelta (o externa) va a /home', async () => {
      const f = await crear(LoginPage, 'https://otro.sitio');
      f.componentInstance.ingresar();
      expect(navegar).toHaveBeenCalledWith('/home');
    });

    it('muestra el mensaje de error', async () => {
      auth.login.mockReturnValue(throwError(() => ({ mensaje: 'Correo o contraseña incorrectos.' })));
      const f = await crear(LoginPage);

      f.componentInstance.ingresar();

      expect(html(f).querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        'Correo o contraseña incorrectos.',
      );
    });
  });

  describe('RegistroPage', () => {
    it('elige alergias con los chips y registra con ellas', async () => {
      const f = await crear(RegistroPage);
      Object.assign(f.componentInstance, { nombre: 'Ana', correo: 'ana@correo.cl', password: 'x1' });

      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="mani"]')!.click();
      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="lacteos"]')!.click();
      expect(html(f).querySelector('ion-chip[data-codigo="mani"]')?.getAttribute('aria-pressed')).toBe('true');
      f.componentInstance.registrar();

      expect(auth.registrar).toHaveBeenCalledWith({
        nombre: 'Ana',
        correo: 'ana@correo.cl',
        password: 'x1',
        alergias: ['mani', 'lacteos'],
      });
      expect(navegar).toHaveBeenCalledWith('/home');
    });

    it('un chip elegido se puede quitar', async () => {
      const f = await crear(RegistroPage);
      const chip = () => html(f).querySelector<HTMLElement>('ion-chip[data-codigo="soya"]')!;

      chip().click();
      chip().click();

      expect(f.componentInstance.alergias()).toEqual([]);
    });
  });

  describe('PerfilPage', () => {
    it('muestra los datos y guarda las alergias editadas', async () => {
      const f = await crear(PerfilPage);
      expect(html(f).querySelector('.nombre')?.textContent).toBe('Ana');
      expect(html(f).querySelector('.correo')?.textContent).toBe('ana@correo.cl');

      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="gluten"]')!.click();
      f.componentInstance.guardar();

      expect(auth.actualizarAlergias).toHaveBeenCalledWith(['mani', 'gluten']);
      expect(html(f).querySelector('[role="status"]')?.textContent).toBe('Alergias guardadas.');
    });

    it('carga el perfil si todavía no está', async () => {
      auth.usuario.set(null);
      const f = await crear(PerfilPage);

      expect(auth.cargarPerfil).toHaveBeenCalled();
      expect(f.componentInstance.alergias()).toEqual(['mani']);
    });

    it('cierra la sesión y vuelve a home', async () => {
      const f = await crear(PerfilPage);

      html(f).querySelector<HTMLElement>('ion-button.salir')!.click();

      expect(auth.cerrarSesion).toHaveBeenCalled();
      expect(navegar).toHaveBeenCalledWith('/home');
    });
  });
});
