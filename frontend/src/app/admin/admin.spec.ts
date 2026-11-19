import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import type { Mock } from 'vitest';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ErrorApi } from '../products/models/error';
import { AdminPage } from './admin.page';
import { AdminPageModule } from './admin.module';
import { AdminService, AlimentoAnalizado, UsuarioResumen } from './admin.service';

const API = `${environment.apiUrl}/api`;

const USUARIOS: UsuarioResumen[] = [
  { id: 'u2', nombre: 'Admin', correo: 'admin@correo.cl', rol: 'administrador' },
  { id: 'u1', nombre: 'Ana', correo: 'ana@correo.cl', rol: 'usuario' },
];
const ALIMENTOS: AlimentoAnalizado[] = [
  {
    id: 'f1',
    nombre: 'Barrita',
    ingredientes: ['avena', 'maní'],
    alergenosPresentes: ['maní'],
    esNutricionalmenteSaludable: true,
  },
  {
    id: 'f2',
    nombre: 'Agua',
    ingredientes: ['agua'],
    alergenosPresentes: null,
    esNutricionalmenteSaludable: false,
  },
];
const SIN_PERMISO: ErrorApi = {
  status: 403,
  codigo: null,
  mensaje: 'No tienes permiso para esta acción',
  requestId: null,
};

describe('AdminService', () => {
  let service: AdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it.each([
    ['usuarios', '/usuarios', USUARIOS],
    ['alimentos', '/food', ALIMENTOS],
  ] as const)('%s hace GET a /api%s y devuelve la lista', async (metodo, ruta, cuerpo) => {
    const llamar = service[metodo].bind(service) as () => Observable<unknown>;
    const resultado = firstValueFrom(llamar());

    const req = httpMock.expectOne(`${API}${ruta}`);
    expect(req.request.method).toBe('GET');
    req.flush(cuerpo);

    await expect(resultado).resolves.toEqual(cuerpo);
  });

  it('convierte el 403 en ErrorApi con el mensaje del backend', async () => {
    const resultado = firstValueFrom(service.usuarios());

    httpMock
      .expectOne(`${API}/usuarios`)
      .flush(
        { statusCode: 403, message: 'No tienes permiso para esta acción' },
        { status: 403, statusText: 'Forbidden' },
      );

    await expect(resultado).rejects.toEqual(SIN_PERMISO);
  });
});

describe('AdminPage', () => {
  let fixture: ComponentFixture<AdminPage>;
  let usuarios: Mock<AdminService['usuarios']>;
  let alimentos: Mock<AdminService['alimentos']>;

  async function crear() {
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), AdminPageModule],
      providers: [
        provideRouter([]),
        { provide: AdminService, useValue: { usuarios, alimentos } },
        {
          provide: AuthService,
          useValue: { autenticado: signal(true), esAdmin: signal(true) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    usuarios = vi.fn<AdminService['usuarios']>().mockReturnValue(of(USUARIOS));
    alimentos = vi.fn<AdminService['alimentos']>().mockReturnValue(of(ALIMENTOS));
  });

  const raiz = () => {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const texto = (selector: string) =>
    (raiz().querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const textos = (selector: string) =>
    Array.from(raiz().querySelectorAll(selector)).map((e) =>
      (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );

  it('usa la barra compartida con el título "Administración"', async () => {
    await crear();

    expect(texto('app-barra-superior ion-title')).toBe('Administración');
  });

  it('lista los usuarios con su correo y marca a los administradores con texto', async () => {
    await crear();

    expect(texto('.usuarios .resumen')).toBe('2 usuarios');
    expect(textos('.usuarios li .nombre')).toEqual(['Admin', 'Ana']);
    expect(textos('.usuarios li .detalle')).toEqual(['admin@correo.cl', 'ana@correo.cl']);
    expect(textos('.usuarios .etiqueta-rol')).toEqual(['Administrador']);
  });

  it('lista los alimentos analizados con sus alérgenos y si son saludables', async () => {
    await crear();

    expect(texto('.alimentos .resumen')).toBe('2 alimentos');
    expect(textos('.alimentos li')).toEqual([
      'Barrita Alérgenos: maní Saludable: Sí',
      'Agua Sin alérgenos detectados Saludable: No',
    ]);
  });

  it('sin alimentos lo dice', async () => {
    alimentos.mockReturnValue(of([]));
    await crear();

    expect(texto('.alimentos .resumen')).toBe('Todavía no hay alimentos analizados.');
  });

  it('muestra un spinner por sección mientras carga', async () => {
    usuarios.mockReturnValue(new Subject<UsuarioResumen[]>());
    await crear();

    expect(raiz().querySelector('.usuarios ion-spinner')).not.toBeNull();
    expect(raiz().querySelector('.alimentos ion-spinner')).toBeNull();
  });

  it('un error en una sección no oculta la otra', async () => {
    usuarios.mockReturnValue(throwError(() => SIN_PERMISO));
    await crear();

    expect(texto('.usuarios .error[role="alert"]')).toBe('No tienes permiso para esta acción');
    expect(textos('.alimentos li .nombre')).toEqual(['Barrita', 'Agua']);
  });

  it('"Actualizar administración" vuelve a pedir las dos listas', async () => {
    await crear();
    const boton = fixture.debugElement
      .queryAll(By.css('app-barra-superior ion-button'))
      .find((b) => b.attributes['aria-label'] === 'Actualizar administración');

    (boton!.nativeElement as HTMLElement).click();

    expect(usuarios).toHaveBeenCalledTimes(2);
    expect(alimentos).toHaveBeenCalledTimes(2);
  });
});
