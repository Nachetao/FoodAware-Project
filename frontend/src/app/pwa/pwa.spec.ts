import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular/lazy';
import { HttpErrorResponse } from '@angular/common/http';
import { AvisoSinConexionComponent, TEXTO_SIN_CONEXION } from './aviso-sin-conexion.component';
import { ConexionService } from './conexion.service';
import { EventoInstalacion, InstalacionService } from './instalacion.service';
import { PwaModule } from './pwa.module';
import { aErrorApi } from '../products/products.service';

/** Simula el cambio de conexión del navegador. */
function cambiarConexion(enLinea: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(enLinea);
  window.dispatchEvent(new Event(enLinea ? 'online' : 'offline'));
}

afterEach(() => vi.restoreAllMocks());

describe('ConexionService', () => {
  it('sigue los eventos online y offline del navegador', () => {
    TestBed.configureTestingModule({});
    const conexion = TestBed.inject(ConexionService);
    expect(conexion.enLinea()).toBe(true);

    cambiarConexion(false);
    expect(conexion.enLinea()).toBe(false);

    cambiarConexion(true);
    expect(conexion.enLinea()).toBe(true);
  });
});

describe('AvisoSinConexionComponent', () => {
  let fixture: ComponentFixture<AvisoSinConexionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), PwaModule],
    }).compileComponents();
    fixture = TestBed.createComponent(AvisoSinConexionComponent);
    fixture.detectChanges();
  });

  const region = () => {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')!;
  };

  it('con conexión deja la región de estado vacía', () => {
    expect(region()).not.toBeNull();
    expect(region().textContent?.trim()).toBe('');
    expect(region().classList.contains('visible')).toBe(false);
  });

  it('sin conexión explica qué funciona y qué no, en la región de estado', () => {
    cambiarConexion(false);

    expect(region().classList.contains('visible')).toBe(true);
    expect(region().textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `Sin conexión. ${TEXTO_SIN_CONEXION}`,
    );
    expect(region().querySelector('ion-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('desaparece al volver la conexión', () => {
    cambiarConexion(false);
    region();
    cambiarConexion(true);

    expect(region().textContent?.trim()).toBe('');
  });
});

describe('InstalacionService', () => {
  function eventoInstalacion(outcome: 'accepted' | 'dismissed') {
    const evento = new Event('beforeinstallprompt', { cancelable: true }) as EventoInstalacion;
    const prompt = vi.fn().mockResolvedValue(undefined);
    Object.assign(evento, { prompt, userChoice: Promise.resolve({ outcome }) });
    return { evento, prompt };
  }

  let instalacion: InstalacionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    instalacion = TestBed.inject(InstalacionService);
  });

  it('no está disponible hasta que el navegador lo ofrece', async () => {
    expect(instalacion.disponible()).toBe(false);
    await expect(instalacion.instalar()).resolves.toBe(false);
  });

  it('guarda el evento, evita la mini barra del navegador y muestra su diálogo al instalar', async () => {
    const { evento, prompt } = eventoInstalacion('accepted');
    window.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
    expect(instalacion.disponible()).toBe(true);

    await expect(instalacion.instalar()).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(instalacion.disponible()).toBe(false);
  });

  it('si el usuario rechaza, devuelve false y deja de ofrecerlo', async () => {
    window.dispatchEvent(eventoInstalacion('dismissed').evento);

    await expect(instalacion.instalar()).resolves.toBe(false);
    expect(instalacion.disponible()).toBe(false);
  });

  it('deja de ofrecerlo cuando la app se instala', () => {
    window.dispatchEvent(eventoInstalacion('accepted').evento);
    window.dispatchEvent(new Event('appinstalled'));

    expect(instalacion.disponible()).toBe(false);
  });
});

describe('aErrorApi con y sin conexión', () => {
  const contrato504 = () =>
    new HttpErrorResponse({
      status: 504,
      error: { error: { codigo: 'SOURCE_TIMEOUT', mensaje: 'El servicio de búsqueda no respondió a tiempo.', request_id: 'r1' } },
    });
  // Lo que responde el service worker de Angular si falla la red de un dataGroup sin caché.
  const vacio504 = () => new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout', error: null });
  const sinRespuesta = () => new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
  const validacion = () => new HttpErrorResponse({ status: 400, error: { message: ['nombre vacío'] } });

  describe('sin conexión', () => {
    beforeEach(() => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false));

    it.each([
      ['un error del contrato', contrato504, 504],
      ['el 504 vacío del service worker', vacio504, 504],
      ['una petición sin respuesta', sinRespuesta, 0],
      ['un error de validación', validacion, 400],
    ])('con %s dice que no hay conexión y conserva el status', (_caso, error, status) => {
      expect(aErrorApi(error())).toEqual({
        status,
        codigo: null,
        mensaje: 'No hay conexión a internet.',
        requestId: null,
      });
    });
  });

  describe('con conexión', () => {
    it.each([
      ['una petición sin respuesta (red caída o CORS)', sinRespuesta],
      // HttpClient con fetch: el cuerpo del error es el TypeError del navegador.
      [
        'el "Failed to fetch" de fetch',
        () => new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }),
      ],
      ['el 504 vacío del service worker', vacio504],
    ])('con %s dice que no se pudo conectar con el servidor', (_caso, error) => {
      expect(aErrorApi(error()).mensaje).toBe('No se pudo conectar con el servidor.');
    });

    it('un 504 del backend conserva el mensaje y el código del contrato', () => {
      expect(aErrorApi(contrato504())).toEqual({
        status: 504,
        codigo: 'SOURCE_TIMEOUT',
        mensaje: 'El servicio de búsqueda no respondió a tiempo.',
        requestId: 'r1',
      });
    });

    it('otro error sin cuerpo muestra el genérico con el status', () => {
      expect(aErrorApi(new HttpErrorResponse({ status: 502, error: null })).mensaje).toBe(
        'Ocurrió un error inesperado (HTTP 502).',
      );
    });
  });
});
