import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { MetricasService } from './metricas.service';
import { ErrorApi } from './models/error';

describe('MetricasService', () => {
  let service: MetricasService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MetricasService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it.each([
    ['calidad', '/api/metricas/calidad'],
    ['evaluacion', '/api/metricas/evaluacion'],
    ['ultimaIngesta', '/api/ingesta/ultima'],
  ] as const)('%s hace GET a %s y devuelve el cuerpo', async (metodo, ruta) => {
    const cuerpo = { total_productos: 1240 };
    const llamar = service[metodo].bind(service) as () => Observable<unknown>;
    const resultado = firstValueFrom(llamar());

    const req = httpMock.expectOne(`${environment.apiUrl}${ruta}`);
    expect(req.request.method).toBe('GET');
    req.flush(cuerpo);

    await expect(resultado).resolves.toEqual(cuerpo);
  });

  it('convierte el 404 de la última ingesta en ErrorApi NOT_FOUND', async () => {
    const resultado = firstValueFrom(service.ultimaIngesta());

    httpMock
      .expectOne(`${environment.apiUrl}/api/ingesta/ultima`)
      .flush(
        { error: { codigo: 'NOT_FOUND', mensaje: 'No hay ingestas', request_id: 'r' } },
        { status: 404, statusText: 'Not Found' },
      );

    await expect(resultado).rejects.toEqual({
      status: 404,
      codigo: 'NOT_FOUND',
      mensaje: 'No hay ingestas',
      requestId: 'r',
    } satisfies ErrorApi);
  });

  it('informa que no hay conexión si el servidor no responde', async () => {
    const resultado = firstValueFrom(service.calidad());

    httpMock
      .expectOne(`${environment.apiUrl}/api/metricas/calidad`)
      .error(new ProgressEvent('error'));

    await expect(resultado).rejects.toMatchObject({
      status: 0,
      mensaje: 'No se pudo conectar con el servidor.',
    });
  });
});
