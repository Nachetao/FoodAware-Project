import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ProductsService } from './products.service';
import { RespuestaBusqueda } from './models/busqueda';
import { ErrorApi, ErrorContrato, esErrorContrato } from './models/error';

const SEARCH_URL = `${environment.apiUrl}/api/products/search`;

const respuestaBusqueda: RespuestaBusqueda = {
  consulta: 'leche',
  total: 1,
  tiempo_ms: 3.2,
  estado_fuente: 'online',
  resultados: [
    {
      score: 7.42,
      posicion: 1,
      producto: {
        codigo_barras: '7801234000018',
        nombre: 'Leche semidescremada',
        marca: 'Colun',
        cantidad: '1 L',
        ingredientes_texto: 'Leche semidescremada, vitaminas A, D3.',
        ingredientes: ['leche semidescremada', 'vitaminas a, d3'],
        alergenos: ['lacteos'],
        trazas: [],
        etiquetas_dieta: ['vegetariano', 'sin_gluten'],
        nutriscore: 'b',
        imagen_url: null,
        procedencia: {
          fuente: 'openfoodfacts',
          url_fuente: 'https://world.openfoodfacts.org/product/7801234000018',
          recuperado_en: '2026-10-20T14:30:00Z',
          modificado_en_fuente: null,
          run_id: '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b',
          hash_contenido: 'a'.repeat(64),
        },
        calidad: { es_valido: true, problemas: ['sin_imagen'], completitud: 0.83 },
      },
    },
  ],
};

function errorContrato(codigo: ErrorContrato['error']['codigo'], mensaje: string): ErrorContrato {
  return { error: { codigo, mensaje, request_id: 'req-123' } };
}

describe('ProductsService', () => {
  let service: ProductsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function esperarBusqueda() {
    return httpMock.expectOne((req) => req.url === SEARCH_URL);
  }

  describe('buscar', () => {
    it('hace GET al endpoint con q, limit y offset', async () => {
      const resultado = firstValueFrom(service.buscar('pan integral', 20, 40));

      const req = esperarBusqueda();
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('pan integral');
      expect(req.request.params.get('limit')).toBe('20');
      expect(req.request.params.get('offset')).toBe('40');
      req.flush(respuestaBusqueda);

      await resultado;
    });

    it('usa limit 10 y offset 0 por defecto', async () => {
      const resultado = firstValueFrom(service.buscar('leche'));

      const req = esperarBusqueda();
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('0');
      req.flush(respuestaBusqueda);

      await resultado;
    });

    it('devuelve la respuesta del backend sin modificarla', async () => {
      const resultado = firstValueFrom(service.buscar('leche'));

      esperarBusqueda().flush(respuestaBusqueda, {
        headers: { 'X-Fuente-Datos': 'fastapi' },
      });

      await expect(resultado).resolves.toEqual({
        respuesta: respuestaBusqueda,
        desdeRespaldo: false,
      });
    });

    it.each([
      ['respaldo', true],
      ['fastapi', false],
      [null, false],
    ])(
      'con X-Fuente-Datos %s marca desdeRespaldo como %s',
      async (fuente, desdeRespaldo) => {
        const resultado = firstValueFrom(service.buscar('leche'));

        esperarBusqueda().flush(respuestaBusqueda, {
          headers: fuente ? { 'X-Fuente-Datos': fuente } : {},
        });

        expect((await resultado).desdeRespaldo).toBe(desdeRespaldo);
      },
    );

    it.each([
      [422, 'VALIDATION_ERROR', 'Solicitud inválida: q debe tener entre 2 y 100 caracteres'],
      [503, 'SOURCE_UNAVAILABLE', 'El servicio de búsqueda no está disponible'],
      [504, 'SOURCE_TIMEOUT', 'El servicio de búsqueda no respondió a tiempo'],
    ] as const)(
      'convierte un %i del contrato en ErrorApi con su mensaje',
      async (status, codigo, mensaje) => {
        const resultado = firstValueFrom(service.buscar('leche'));

        esperarBusqueda().flush(errorContrato(codigo, mensaje), {
          status,
          statusText: 'Error',
        });

        await expect(resultado).rejects.toEqual({
          status,
          codigo,
          mensaje,
          requestId: 'req-123',
        } satisfies ErrorApi);
      },
    );

    it('informa que no hay conexión si el servidor no responde', async () => {
      const resultado = firstValueFrom(service.buscar('leche'));

      esperarBusqueda().error(new ProgressEvent('error'));

      await expect(resultado).rejects.toEqual({
        status: 0,
        codigo: null,
        mensaje: 'No se pudo conectar con el servidor.',
        requestId: null,
      } satisfies ErrorApi);
    });

    it('usa un mensaje genérico si el error no sigue el contrato', async () => {
      const resultado = firstValueFrom(service.buscar('leche'));

      esperarBusqueda().flush('<html>Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
      });

      await expect(resultado).rejects.toEqual({
        status: 502,
        codigo: null,
        mensaje: 'Ocurrió un error inesperado (HTTP 502).',
        requestId: null,
      } satisfies ErrorApi);
    });
  });

  describe('esErrorContrato', () => {
    it('acepta el formato de error del contrato', () => {
      expect(esErrorContrato(errorContrato('NOT_FOUND', 'No existe'))).toBe(true);
    });

    it.each([
      ['null', null],
      ['un texto', 'Bad Gateway'],
      ['el error nativo de NestJS', { statusCode: 400, message: ['q'] }],
      ['el error nativo de FastAPI', { detail: 'Not Found' }],
      ['un código fuera del contrato', { error: { codigo: 'OTRO', mensaje: 'x', request_id: 'r' } }],
      ['sin request_id', { error: { codigo: 'NOT_FOUND', mensaje: 'x' } }],
    ])('rechaza %s', (_caso, cuerpo) => {
      expect(esErrorContrato(cuerpo)).toBe(false);
    });
  });

  describe('obtener', () => {
    const PRODUCTO_URL = `${environment.apiUrl}/api/products/7801234000018`;
    const producto = respuestaBusqueda.resultados[0].producto;

    it.each([
      ['respaldo', true],
      ['fastapi', false],
    ])('hace GET al detalle y marca desdeRespaldo con X-Fuente-Datos %s', async (fuente, esperado) => {
      const resultado = firstValueFrom(service.obtener('7801234000018'));

      httpMock
        .expectOne(PRODUCTO_URL)
        .flush(producto, { headers: { 'X-Fuente-Datos': fuente } });

      await expect(resultado).resolves.toEqual({ producto, desdeRespaldo: esperado });
    });

    it('convierte el 404 en ErrorApi NOT_FOUND', async () => {
      const resultado = firstValueFrom(service.obtener('7801234000018'));

      httpMock
        .expectOne(PRODUCTO_URL)
        .flush(errorContrato('NOT_FOUND', 'Producto 7801234000018 no encontrado'), {
          status: 404,
          statusText: 'Not Found',
        });

      await expect(resultado).rejects.toMatchObject({ status: 404, codigo: 'NOT_FOUND' });
    });
  });

  describe('compatibilidad', () => {
    const URL = `${environment.apiUrl}/api/products/7801234000018/compatibilidad`;
    const cuerpo = {
      codigo_barras: '7801234000018',
      veredicto: 'no_apto',
      apto: false,
      alergenos_en_conflicto: ['lacteos'],
      trazas_en_conflicto: [],
      dietas_no_confirmadas: [],
      conflictos: [{ codigo: 'lacteos', tipo: 'alergeno', origen: 'fuente' }],
      motivos_no_apto: [{ tipo: 'alergeno', codigo: 'lacteos' }],
      datos_suficientes: true,
      explicacion: 'Contiene lácteos, que está en tu perfil.',
      confianza: 'alta',
      motivos_confianza: [],
      aviso: 'Clasificación orientativa según tu perfil y los datos de Open Food Facts.',
    };

    it.each([
      ['respaldo', true],
      ['fastapi', false],
    ])(
      'hace GET a /:codigo/compatibilidad y marca desdeRespaldo con X-Fuente-Datos %s',
      async (fuente, esperado) => {
        const resultado = firstValueFrom(service.compatibilidad('7801234000018'));

        httpMock.expectOne(URL).flush(cuerpo, { headers: { 'X-Fuente-Datos': fuente } });

        await expect(resultado).resolves.toEqual({
          compatibilidad: cuerpo,
          desdeRespaldo: esperado,
        });
      },
    );

    it('sin el header X-Fuente-Datos no es respaldo', async () => {
      const resultado = firstValueFrom(service.compatibilidad('7801234000018'));

      httpMock.expectOne(URL).flush(cuerpo);

      await expect(resultado).resolves.toMatchObject({ desdeRespaldo: false });
    });

    it('convierte el error en ErrorApi', async () => {
      const resultado = firstValueFrom(service.compatibilidad('7801234000018'));

      httpMock
        .expectOne(URL)
        .flush(errorContrato('NOT_FOUND', 'No existe'), { status: 404, statusText: 'Not Found' });

      await expect(resultado).rejects.toMatchObject({ status: 404, codigo: 'NOT_FOUND' });
    });
  });

  describe('buscarPersonalizado', () => {
    const URL = `${environment.apiUrl}/api/products/search/personalizada`;
    const respuesta = {
      consulta: 'chocolate sin leche',
      interpretacion: {
        terminos: ['chocolate'],
        restricciones: [{ texto: 'sin leche', tipo: 'alergeno', codigo: 'lacteos' }],
        no_reconocidas: [],
      },
      perfil_aplicado: { alergias: ['lacteos'], dietas: [], modo_estricto: false },
      modo: 'filtrar',
      total: 0,
      total_base: 3,
      tiempo_ms: 2.1,
      estado_fuente: 'online',
      resultados: [],
      no_aptos: { total: 3, ocultos: true, motivos: [], texto: '3 ocultos por contener lácteos.' },
      comparacion: null,
      aviso: 'Clasificación orientativa.',
    };

    it('hace GET a /search/personalizada con q, modo, limit y offset', async () => {
      const resultado = firstValueFrom(
        service.buscarPersonalizado('chocolate sin leche', 'reordenar', 20, 40),
      );

      const req = httpMock.expectOne((r) => r.url === URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('chocolate sin leche');
      expect(req.request.params.get('modo')).toBe('reordenar');
      expect(req.request.params.get('limit')).toBe('20');
      expect(req.request.params.get('offset')).toBe('40');
      req.flush(respuesta, { headers: { 'X-Fuente-Datos': 'fastapi' } });

      await expect(resultado).resolves.toEqual({ respuesta, desdeRespaldo: false });
    });

    it('usa limit 10 y offset 0 por defecto y marca el respaldo', async () => {
      const resultado = firstValueFrom(service.buscarPersonalizado('chocolate', 'filtrar'));

      const req = httpMock.expectOne((r) => r.url === URL);
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('0');
      req.flush(respuesta, { headers: { 'X-Fuente-Datos': 'respaldo' } });

      await expect(resultado).resolves.toMatchObject({ desdeRespaldo: true });
    });

    it('convierte el error en ErrorApi', async () => {
      const resultado = firstValueFrom(service.buscarPersonalizado('chocolate', 'filtrar'));

      httpMock
        .expectOne((r) => r.url === URL)
        .flush(errorContrato('SOURCE_UNAVAILABLE', 'No disponible'), {
          status: 503,
          statusText: 'Service Unavailable',
        });

      await expect(resultado).rejects.toMatchObject({
        status: 503,
        codigo: 'SOURCE_UNAVAILABLE',
      });
    });
  });
});
