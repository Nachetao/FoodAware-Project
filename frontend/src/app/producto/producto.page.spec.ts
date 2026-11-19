import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Subject, map, of, throwError } from 'rxjs';
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

const APTO: Compatibilidad = {
  codigo_barras: '7801234000018',
  veredicto: 'apto',
  apto: true,
  alergenos_en_conflicto: [],
  trazas_en_conflicto: [],
  dietas_no_confirmadas: [],
  conflictos: [],
  motivos_no_apto: [],
  datos_suficientes: true,
  explicacion: 'No contiene nada de tu perfil.',
  confianza: 'alta',
  motivos_confianza: [],
  aviso: 'Clasificación orientativa según tu perfil y los datos de Open Food Facts.',
};
const CON_ADVERTENCIA: Compatibilidad = {
  ...APTO,
  veredicto: 'apto_con_advertencia',
  apto: false,
  trazas_en_conflicto: ['mani'],
  conflictos: [{ codigo: 'mani', tipo: 'traza', origen: 'fuente' }],
  explicacion: 'Puede contener maní, que está en tu perfil.',
  confianza: 'media',
  motivos_confianza: ['completitud_media'],
};
const NO_APTO: Compatibilidad = {
  ...APTO,
  veredicto: 'no_apto',
  apto: false,
  alergenos_en_conflicto: ['lacteos', 'soya'],
  conflictos: [
    { codigo: 'lacteos', tipo: 'alergeno', origen: 'fuente' },
    { codigo: 'soya', tipo: 'alergeno', origen: 'fuente' },
  ],
  motivos_no_apto: [
    { tipo: 'alergeno', codigo: 'lacteos' },
    { tipo: 'alergeno', codigo: 'soya' },
  ],
  explicacion: 'Contiene lácteos y soya, que están en tu perfil.',
};

describe('ProductoPage', () => {
  let fixture: ComponentFixture<ProductoPage>;
  let obtener: Mock<(codigo: string) => ReturnType<ProductsService['obtener']>>;
  let compatibilidad: Mock<ProductsService['compatibilidad']>;
  let autenticado: ReturnType<typeof signal<boolean>>;

  async function crear(
    respuesta = of<DetalleProducto>({ producto: PRODUCTO, desdeRespaldo: false }),
    {
      conSesion = false,
      compatible = of<Compatibilidad>(APTO),
      compatibilidadDesdeRespaldo = false,
    } = {},
  ) {
    obtener = vi.fn(() => respuesta);
    compatibilidad = vi.fn(() =>
      compatible.pipe(
        map((c) => ({ compatibilidad: c, desdeRespaldo: compatibilidadDesdeRespaldo })),
      ),
    );
    autenticado = signal(conSesion);
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), ProductoPageModule],
      providers: [
        provideRouter([]),
        { provide: ProductsService, useValue: { obtener, compatibilidad } },
        { provide: AuthService, useValue: { autenticado, esAdmin: signal(false) } },
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

  describe('veredicto del motor para el perfil del usuario', () => {
    // [name] asigna la propiedad del ion-icon, no el atributo.
    const icono = (selector: string) =>
      (raiz().querySelector(`${selector} ion-icon`) as (Element & { name?: string }) | null)
        ?.name;

    it('sin sesión no lo consulta e invita a iniciar sesión', async () => {
      await crear();

      expect(compatibilidad).not.toHaveBeenCalled();
      expect(raiz().querySelector('.franja')).toBeNull();
      expect(raiz().querySelector('.aviso-orientativo')).toBeNull();
      expect(texto('.invitar-sesion')).toBe('Inicia sesión para saber si es apto para ti.');
      expect(raiz().querySelector('.invitar-sesion a')?.getAttribute('href')).toBe('/login');
      expect(texto('h1.nombre')).toBe('Galletas de avena');
    });

    it('apto: título, ícono de visto bueno y la explicación del motor, en verde', async () => {
      await crear(undefined, { conSesion: true });

      expect(compatibilidad).toHaveBeenCalledWith('7801234000018');
      const franja = raiz().querySelector('.franja.apto[role="status"]');
      expect(franja).not.toBeNull();
      expect(texto('.franja .franja-titulo')).toBe('Apto para ti');
      expect(texto('.franja .explicacion')).toBe('No contiene nada de tu perfil.');
      expect(icono('.franja')).toBe('checkmark-circle-outline');
      expect(raiz().querySelector('.invitar-sesion')).toBeNull();
    });

    it('apto con advertencia: su título, ícono de advertencia y la explicación, en ámbar', async () => {
      await crear(undefined, {
        conSesion: true,
        compatible: of<Compatibilidad>(CON_ADVERTENCIA),
      });

      expect(raiz().querySelector('.franja.apto-con-advertencia[role="status"]')).not.toBeNull();
      expect(texto('.franja .franja-titulo')).toBe('Apto con advertencia');
      expect(texto('.franja .explicacion')).toBe('Puede contener maní, que está en tu perfil.');
      expect(icono('.franja')).toBe('warning-outline');
      expect(raiz().querySelector('.franja.apto')).toBeNull();
    });

    it('no apto: se anuncia como alerta, con su título, ícono y la explicación, en rojo', async () => {
      await crear(undefined, { conSesion: true, compatible: of<Compatibilidad>(NO_APTO) });

      expect(raiz().querySelector('.franja.no-apto[role="alert"]')).not.toBeNull();
      expect(texto('.franja .franja-titulo')).toBe('No apto para ti');
      expect(texto('.franja .explicacion')).toBe(
        'Contiene lácteos y soya, que están en tu perfil.',
      );
      expect(icono('.franja')).toBe('close-circle-outline');
      expect(raiz().querySelector('.franja.apto, .franja.apto-con-advertencia')).toBeNull();
    });

    it.each([
      ['alta', 'Confianza alta: Datos completos y declarados por la fuente.', 3],
      ['media', 'Confianza media: Parte de la información está incompleta o se dedujo del texto.', 2],
      ['baja', 'Confianza baja: Faltan datos o es una revisión básica: revisa la etiqueta.', 1],
    ] as const)('muestra la confianza %s con su frase', async (confianza, frase, llenos) => {
      await crear(undefined, {
        conSesion: true,
        compatible: of<Compatibilidad>({ ...CON_ADVERTENCIA, confianza }),
      });

      expect(texto('.confianza')).toBe(frase);
      expect(raiz().querySelectorAll('.confianza .punto.lleno')).toHaveLength(llenos);
      expect(raiz().querySelector('.confianza .puntos')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    });

    it('muestra el aviso orientativo del motor, siempre', async () => {
      await crear(undefined, { conSesion: true });

      expect(texto('.aviso-orientativo[role="status"]')).toBe(
        'Clasificación orientativa según tu perfil y los datos de Open Food Facts.',
      );
    });

    it('enlaza a "Editar mis alergias" en el perfil', async () => {
      await crear(undefined, { conSesion: true });

      const enlace = raiz().querySelector('a.editar-alergias');
      expect(enlace?.textContent?.trim()).toBe('Editar mis alergias');
      expect(enlace?.getAttribute('href')).toBe('/perfil');
    });

    it('sin respaldo no muestra la revisión básica', async () => {
      await crear(undefined, { conSesion: true });

      expect(raiz().querySelector('.revision-basica')).toBeNull();
    });

    it('indica la revisión básica si el veredicto vino del respaldo', async () => {
      await crear(undefined, {
        conSesion: true,
        compatible: of<Compatibilidad>({
          ...CON_ADVERTENCIA,
          confianza: 'baja',
          motivos_confianza: ['evaluacion_de_respaldo'],
        }),
        compatibilidadDesdeRespaldo: true,
      });

      expect(texto('.revision-basica[role="status"]')).toBe(
        'Revisión básica: el servicio de evaluación no estaba disponible.',
      );
    });

    it('también la indica por el motivo evaluacion_de_respaldo, aunque falte el header', async () => {
      await crear(undefined, {
        conSesion: true,
        compatible: of<Compatibilidad>({
          ...CON_ADVERTENCIA,
          motivos_confianza: ['evaluacion_de_respaldo'],
        }),
      });

      expect(raiz().querySelector('.revision-basica')).not.toBeNull();
    });

    it('si falla, muestra el detalle sin veredicto ni alerta', async () => {
      const error: ErrorApi = { status: 500, codigo: null, mensaje: 'Error', requestId: null };
      await crear(undefined, { conSesion: true, compatible: throwError(() => error) });

      expect(raiz().querySelector('.franja')).toBeNull();
      expect(raiz().querySelector('[role="alert"]')).toBeNull();
      expect(raiz().querySelector('.invitar-sesion')).toBeNull();
      expect(texto('h1.nombre')).toBe('Galletas de avena');
    });

    it('al cerrar la sesión quita el veredicto e invita a iniciar sesión', async () => {
      await crear(undefined, { conSesion: true });
      expect(raiz().querySelector('.franja')).not.toBeNull();

      autenticado.set(false);

      expect(raiz().querySelector('.franja')).toBeNull();
      expect(raiz().querySelector('.aviso-orientativo')).toBeNull();
      expect(raiz().querySelector('.invitar-sesion')).not.toBeNull();
    });
  });
});
