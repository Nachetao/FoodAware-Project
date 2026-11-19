import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AlertController, IonicModule } from '@ionic/angular/lazy';
import { of, throwError } from 'rxjs';
import { AuthService, Usuario } from '../auth/auth.service';
import { CuentaModule } from './cuenta.module';
import { LoginPage } from './login.page';
import { AYUDA_MODO_ESTRICTO, PerfilPage } from './perfil.page';
import { RegistroPage } from './registro.page';

const ANA: Usuario = {
  id: 'u1',
  nombre: 'Ana',
  correo: 'ana@correo.cl',
  alergias: ['mani'],
  dietas: [],
  modo_estricto: false,
  rol: 'usuario',
};

describe('Cuenta: login, registro y perfil', () => {
  let auth: {
    usuario: ReturnType<typeof signal<Usuario | null>>;
    autenticado: () => boolean;
    esAdmin: () => boolean;
    login: ReturnType<typeof vi.fn>;
    registrar: ReturnType<typeof vi.fn>;
    cargarPerfil: ReturnType<typeof vi.fn>;
    actualizarPerfil: ReturnType<typeof vi.fn>;
    borrarCuenta: ReturnType<typeof vi.fn>;
    cerrarSesion: ReturnType<typeof vi.fn>;
  };
  let navegar: ReturnType<typeof vi.spyOn>;
  let crearAlerta: ReturnType<typeof vi.fn>;

  async function crear<T>(pagina: Type<T>, volver?: string): Promise<ComponentFixture<T>> {
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), CuentaModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: AlertController, useValue: { create: crearAlerta } },
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
      // La barra superior muestra "Mi perfil" o "Ingresar" según la sesión.
      autenticado: () => auth.usuario() !== null,
      esAdmin: () => false,
      login: vi.fn(() => of(ANA)),
      registrar: vi.fn(() => of(ANA)),
      cargarPerfil: vi.fn(() => of(ANA)),
      actualizarPerfil: vi.fn((cambios) => of({ ...ANA, ...cambios })),
      borrarCuenta: vi.fn(() => of(undefined)),
      cerrarSesion: vi.fn(),
    };
    crearAlerta = vi.fn().mockResolvedValue({ present: vi.fn() });
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
    // Ionic al escribir o cambiar un control: actualiza el valor y emite el evento.
    const emitir = (f: ComponentFixture<unknown>, selector: string, evento: string, detail: object) =>
      html(f).querySelector(selector)!.dispatchEvent(new CustomEvent(evento, { detail }));
    const botonGuardar = (f: ComponentFixture<unknown>) =>
      html(f).querySelector('ion-button.guardar') as HTMLElement & { disabled: boolean };

    it('muestra el nombre, el correo y los valores guardados', async () => {
      auth.usuario.set({ ...ANA, dietas: ['vegano'], modo_estricto: true });
      const f = await crear(PerfilPage);

      expect(html(f).querySelector('.nombre')?.textContent).toBe('Ana');
      expect(html(f).querySelector('.correo')?.textContent).toBe('ana@correo.cl');
      expect(html(f).querySelector('ion-chip[data-codigo="mani"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(html(f).querySelector('ion-chip[data-codigo="vegano"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(f.componentInstance.modoEstricto()).toBe(true);
    });

    it('explica qué hace el modo estricto', async () => {
      const f = await crear(PerfilPage);

      expect(html(f).querySelector('.ayuda-estricto')?.textContent).toBe(AYUDA_MODO_ESTRICTO);
    });

    it('"Guardar cambios" empieza deshabilitado y se habilita al cambiar algo', async () => {
      const f = await crear(PerfilPage);
      expect(botonGuardar(f).disabled).toBe(true);

      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="sin_gluten"]')!.click();

      expect(botonGuardar(f).disabled).toBe(false);
    });

    it('guarda nombre, alergias, dietas y modo estricto con un solo PATCH', async () => {
      const f = await crear(PerfilPage);

      emitir(f, 'ion-input.campo-nombre', 'ionInput', { value: '  Ana María ' });
      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="gluten"]')!.click();
      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="vegetariano"]')!.click();
      emitir(f, 'ion-toggle.modo-estricto', 'ionChange', { checked: true });
      botonGuardar(f).click();

      expect(auth.actualizarPerfil).toHaveBeenCalledWith({
        nombre: 'Ana María',
        alergias: ['mani', 'gluten'],
        dietas: ['vegetariano'],
        modo_estricto: true,
      });
      expect(html(f).querySelector('[role="status"]')?.textContent).toBe('Cambios guardados.');
    });

    it('no deja guardar un nombre vacío', async () => {
      const f = await crear(PerfilPage);

      emitir(f, 'ion-input.campo-nombre', 'ionInput', { value: '   ' });

      expect(botonGuardar(f).disabled).toBe(true);
      expect(html(f).textContent).toContain('El nombre no puede quedar vacío.');
    });

    it('muestra el error si no se pudo guardar', async () => {
      auth.actualizarPerfil.mockReturnValue(throwError(() => ({ mensaje: 'Cada dieta debe ser…' })));
      const f = await crear(PerfilPage);
      html(f).querySelector<HTMLElement>('ion-chip[data-codigo="vegano"]')!.click();

      f.componentInstance.guardar();

      expect(html(f).querySelector('[role="alert"]')?.textContent?.trim()).toBe('Cada dieta debe ser…');
    });

    it('carga el perfil si todavía no está', async () => {
      auth.usuario.set(null);
      auth.cargarPerfil.mockReturnValue(of({ ...ANA, dietas: ['sin_lactosa'] }));
      const f = await crear(PerfilPage);

      expect(auth.cargarPerfil).toHaveBeenCalled();
      expect(f.componentInstance.alergias()).toEqual(['mani']);
      expect(f.componentInstance.dietas()).toEqual(['sin_lactosa']);
    });

    it('cierra la sesión y vuelve a home', async () => {
      const f = await crear(PerfilPage);

      html(f).querySelector<HTMLElement>('ion-button.salir')!.click();

      expect(auth.cerrarSesion).toHaveBeenCalled();
      expect(navegar).toHaveBeenCalledWith('/home');
    });

    describe('borrar la cuenta', () => {
      const opcionesAlerta = () => crearAlerta.mock.calls[0][0] as {
        header: string;
        message: string;
        buttons: Array<{ text: string; role: string; handler?: () => void }>;
      };
      const confirmar = () =>
        opcionesAlerta().buttons.find((b) => b.role === 'destructive')!.handler!();

      it('pide confirmación antes de borrar, con la opción de cancelar', async () => {
        const f = await crear(PerfilPage);

        html(f).querySelector<HTMLElement>('ion-button.borrar')!.click();
        await f.whenStable();

        expect(opcionesAlerta().header).toBe('¿Borrar tu cuenta?');
        expect(opcionesAlerta().message).toContain('no se puede deshacer');
        expect(opcionesAlerta().buttons.map((b) => [b.text, b.role])).toEqual([
          ['Cancelar', 'cancel'],
          ['Borrar cuenta', 'destructive'],
        ]);
        expect(auth.borrarCuenta).not.toHaveBeenCalled();
      });

      it('al confirmar borra la cuenta y vuelve a home', async () => {
        const f = await crear(PerfilPage);
        await f.componentInstance.confirmarBorrado();

        confirmar();

        expect(auth.borrarCuenta).toHaveBeenCalled();
        expect(navegar).toHaveBeenCalledWith('/home');
      });

      it('si falla, muestra el error y no sale del perfil', async () => {
        auth.borrarCuenta.mockReturnValue(
          throwError(() => ({ mensaje: 'No se pudo conectar con el servidor.' })),
        );
        const f = await crear(PerfilPage);
        await f.componentInstance.confirmarBorrado();

        confirmar();

        expect(html(f).querySelector('[role="alert"]')?.textContent?.trim()).toBe(
          'No se pudo conectar con el servidor.',
        );
        expect(navegar).not.toHaveBeenCalled();
      });
    });
  });
});
