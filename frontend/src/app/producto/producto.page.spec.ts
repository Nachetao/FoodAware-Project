import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Subject, of, throwError } from 'rxjs';
import type { Mock } from 'vitest';

import { ProductoPage } from './producto.page';
import { ProductoPageModule } from './producto.module';
import { AuthService } from '../auth/auth.service';
import { ProductsService } from '../products/products.service';
import { Compatibilidad } from '../products/models/compatibilidad';
import { DetalleProducto, Producto } from '../products/models/producto';
import { ErrorApi } from '../products/models/error';

const PRODUCTO: Producto = {
  codigo_barras: '7801234000018',
  nombre: 'Galletas de avena',
  marca: 'Costa',
  cantidad: '200 g',
  ingredientes_texto: 'Harina de trigo, avena, leche en polvo. Puede contener maní.',
  ingredientes: ['harina de trigo', 'avena', 'leche en polvo'],
  alergenos: ['gluten', 'lacteos'],
  trazas: ['mani'],
  etiquetas_dieta: ['vegetariano'],
  nutriscore: 'c',
  imagen_url: 'https://images.openfoodfacts.org/galletas.jpg',
  procedencia: {
    fuente: 'openfoodfacts',
    url_fuente: 'https://world.openfoodfacts.org/product/7801234000018',
    recuperado_en: '2026-10-20T14:30:00Z',
    modificado_en_fuente: null,
    run_id: '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b',
    hash_contenido: 'a'.repeat(64),
  },
  calidad: {
    es_valido: true,
    problemas: [
      'alergeno_detectado_en_texto:lacteos',
      'traza_detectada_en_texto:mani',
      'sin_cantidad',
      'codigo_desconocido',
    ],
    completitud: 0.9,
  },
};

const APTO: Compatibilidad = { apto: true, alergenos_en_conflicto: [], trazas_en_conflicto: [] };

describe('ProductoPage', () => {
  let fixture: ComponentFixture<ProductoPage>;
  let obtener: Mock<(codigo: string) => ReturnType<ProductsService['obtener']>>;
  let compatibilidad: Mock<ProductsService['compatibilidad']>;
  let autenticado: ReturnType<typeof signal<boolean>>;

  async function crear(
    respuesta = of<DetalleProducto>({ producto: PRODUCTO, desdeRespaldo: false }),
    { conSesion = false, compatible = of<Compatibilidad>(APTO) } = {},
  ) {
    obtener = vi.fn(() => respuesta);
    compatibilidad = vi.fn(() => compatible);
    autenticado = signal(conSesion);
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), ProductoPageModule],
      providers: [
        provideRouter([]),
        { provide: ProductsService, useValue: { obtener, compatibilidad } },
        { provide: AuthService, useValue: { autenticado } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ codigo: '7801234000018' })) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductoPage);
    fixture.detectChanges();
  }

  const raiz = () => {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const textos = (selector: string) =>
    Array.from(raiz().querySelectorAll(selector)).map((e) =>
      (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  const texto = (selector: string) => textos(selector).join(' ');

  it('pide el producto del código de la ruta', async () => {
    await crear();
    expect(obtener).toHaveBeenCalledWith('7801234000018');
  });

  it('muestra imagen, nombre, marca, cantidad y Nutri-Score', async () => {
    await crear();

    expect(raiz().querySelector('img.imagen')?.getAttribute('src')).toBe(PRODUCTO.imagen_url);
    expect(texto('h1.nombre')).toBe('Galletas de avena');
    expect(texto('.marca')).toBe('Costa · 200 g');
    expect(texto('.nutriscore')).toBe('Nutri-Score C');
    expect(raiz().querySelector('.nutriscore')?.classList).toContain('nutri-c');
  });

  it('muestra alérgenos en ámbar, trazas aparte como "Puede contener" y dieta en verde', async () => {
    await crear();

    expect(textos('ion-chip.chip-alergeno')).toEqual(['Gluten', 'Lácteos']);
    expect(texto('section h3')).toBe('Puede contener');
    expect(textos('ion-chip.chip-traza')).toEqual(['Maní']);
    expect(textos('ion-chip.chip-dieta')).toEqual(['Vegetariano']);
  });

  it('muestra el texto original y la lista de ingredientes', async () => {
    await crear();

    expect(texto('.ingredientes-texto')).toBe(PRODUCTO.ingredientes_texto!);
    expect(textos('.ingredientes li')).toEqual(PRODUCTO.ingredientes);
  });

  it('explica por qué se marcaron los alérgenos', async () => {
    await crear();

    expect(textos('.motivos li')).toEqual([
      'Lácteos detectado en el texto de ingredientes.',
      'Trazas de maní detectadas en el texto de ingredientes.',
      'Informados en las etiquetas de Open Food Facts: Gluten.',
    ]);
    // Los demás problemas van aparte; un código desconocido se muestra tal cual.
    expect(textos('.calidad li')).toEqual([
      'La fuente no informa la cantidad.',
      'codigo_desconocido',
    ]);
  });

  it('muestra la procedencia con el enlace a la ficha y la atribución ODbL', async () => {
    await crear();
    const procedencia = raiz().querySelector('.procedencia')!;
    const enlaces = Array.from(procedencia.querySelectorAll('a')).map((a) => a.getAttribute('href'));

    expect(texto('.recuperado')).toMatch(/^Datos recuperados el .*\S$/);
    expect(texto('.procedencia')).not.toContain('..');
    expect(texto('.atribucion')).toBe(
      'Datos de Open Food Facts (openfoodfacts.org), disponibles bajo la licencia Open Database License (ODbL).',
    );
    expect(enlaces).toEqual([
      PRODUCTO.procedencia.url_fuente,
      'https://world.openfoodfacts.org',
      'https://opendatacommons.org/licenses/odbl/1-0/',
    ]);
  });

  it('muestra el aviso si los datos vienen del respaldo', async () => {
    await crear(of({ producto: PRODUCTO, desdeRespaldo: true }));

    expect(texto('.aviso-respaldo[role="status"]')).toContain(
      'El servicio de búsqueda no está disponible; mostrando productos guardados anteriormente.',
    );
  });

  it('muestra un spinner mientras carga', async () => {
    await crear(new Subject<DetalleProducto>());

    expect(raiz().querySelector('ion-spinner')).not.toBeNull();
  });

  it('muestra "Producto no encontrado" ante un 404', async () => {
    const error: ErrorApi = { status: 404, codigo: 'NOT_FOUND', mensaje: 'No existe', requestId: 'r' };
    await crear(throwError(() => error));

    expect(texto('h1')).toBe('Producto no encontrado');
    expect(raiz().querySelector('[role="alert"]')).toBeNull();
  });

  it('muestra el mensaje del contrato ante otro error y permite reintentar', async () => {
    const error: ErrorApi = {
      status: 503,
      codigo: 'SOURCE_UNAVAILABLE',
      mensaje: 'El servicio de búsqueda no está disponible',
      requestId: 'r',
    };
    await crear(throwError(() => error));

    expect(texto('[role="alert"]')).toBe('El servicio de búsqueda no está disponible');

    obtener.mockReturnValue(of({ producto: PRODUCTO, desdeRespaldo: false }));
    raiz().querySelector<HTMLElement>('.estado ion-button')!.click();

    expect(obtener).toHaveBeenCalledTimes(2);
    expect(texto('h1.nombre')).toBe('Galletas de avena');
  });

  describe('compatibilidad con las alergias del usuario', () => {
    it('sin sesión no la consulta ni muestra la franja', async () => {
      await crear();

      expect(compatibilidad).not.toHaveBeenCalled();
      expect(raiz().querySelector('.franja')).toBeNull();
      expect(texto('h1.nombre')).toBe('Galletas de avena');
    });

    it('muestra "Apto para ti" en verde', async () => {
      await crear(undefined, { conSesion: true });

      expect(compatibilidad).toHaveBeenCalledWith('7801234000018');
      expect(texto('.franja.apto[role="status"]')).toBe('Apto para ti');
      expect(raiz().querySelector('.franja.no-apto')).toBeNull();
    });

    it('muestra "No apto" en rojo con los alérgenos en conflicto y las trazas aparte', async () => {
      await crear(undefined, {
        conSesion: true,
        compatible: of<Compatibilidad>({
          apto: false,
          alergenos_en_conflicto: ['lacteos', 'soya'],
          trazas_en_conflicto: ['mani'],
        }),
      });

      expect(texto('.franja.no-apto[role="alert"]')).toBe('No apto: contiene Lácteos, Soya');
      expect(texto('.franja.trazas-en-conflicto')).toBe('Puede contener Maní');
      expect(raiz().querySelector('.franja.apto')).toBeNull();
    });

    it('las trazas en conflicto no quitan el "Apto para ti"', async () => {
      await crear(undefined, {
        conSesion: true,
        compatible: of<Compatibilidad>({ ...APTO, trazas_en_conflicto: ['mani'] }),
      });

      expect(texto('.franja.apto')).toBe('Apto para ti');
      expect(texto('.franja.trazas-en-conflicto')).toBe('Puede contener Maní');
    });

    it('si falla, muestra el detalle sin franja', async () => {
      const error: ErrorApi = { status: 500, codigo: null, mensaje: 'Error', requestId: null };
      await crear(undefined, { conSesion: true, compatible: throwError(() => error) });

      expect(raiz().querySelector('.franja')).toBeNull();
      expect(raiz().querySelector('[role="alert"]')).toBeNull();
      expect(texto('h1.nombre')).toBe('Galletas de avena');
    });

    it('quita la franja al cerrar la sesión', async () => {
      await crear(undefined, { conSesion: true });
      expect(raiz().querySelector('.franja')).not.toBeNull();

      autenticado.set(false);

      expect(raiz().querySelector('.franja')).toBeNull();
    });
  });
});
