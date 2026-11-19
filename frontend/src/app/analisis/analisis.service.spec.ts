import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErrorApi } from '../products/models/error';
import {
  AnalisisService,
  RespuestaAnalisis,
  ResultadoAnalisis,
} from './analisis.service';

describe('AnalisisService', () => {
  const url = `${environment.apiUrl}/api/food/analizar`;
  let service: AnalisisService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalisisService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('hace POST con nombre e ingredientes y devuelve el resultado', async () => {
    const resultado: ResultadoAnalisis = {
      id: 'f-1',
      nombre: 'Barrita',
      ingredientes: ['avena', 'maní'],
      alergenosPresentes: ['maní'],
      esNutricionalmenteSaludable: true,
      aptoParaConsumo: false,
    };
    const analisis = firstValueFrom(
      service.analizar('Barrita', ['avena', 'maní']),
    );

    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      nombre: 'Barrita',
      ingredientes: ['avena', 'maní'],
    });
    req.flush({
      message: 'Análisis completado',
      resultado,
    } satisfies RespuestaAnalisis);

    await expect(analisis).resolves.toEqual(resultado);
  });

  it('convierte el error del backend en ErrorApi con su mensaje', async () => {
    const analisis = firstValueFrom(service.analizar('Barrita', ['avena']));

    httpMock.expectOne(url).flush(
      {
        statusCode: 500,
        message:
          'Error al analizar el producto con IA o guardarlo en la base de datos',
      },
      { status: 500, statusText: 'Internal Server Error' },
    );

    await expect(analisis).rejects.toEqual({
      status: 500,
      codigo: null,
      mensaje:
        'Error al analizar el producto con IA o guardarlo en la base de datos',
      requestId: null,
    } satisfies ErrorApi);
  });

  it('informa que no hay conexión si el servidor no responde', async () => {
    const analisis = firstValueFrom(service.analizar('Barrita', ['avena']));

    httpMock.expectOne(url).error(new ProgressEvent('error'));

    await expect(analisis).rejects.toMatchObject({
      status: 0,
      mensaje: 'No se pudo conectar con el servidor.',
    });
  });
});
