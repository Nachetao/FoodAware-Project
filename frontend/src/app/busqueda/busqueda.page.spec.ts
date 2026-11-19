import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterLink, provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Subject, of, throwError } from 'rxjs';
import type { Mock } from 'vitest';

import { BusquedaPage } from './busqueda.page';
import { BusquedaPageModule } from './busqueda.module';
import { AuthService } from '../auth/auth.service';
import { ProductsService } from '../products/products.service';
import { BusquedaProductos, ResultadoBusqueda } from '../products/models/busqueda';
import {
  BusquedaPersonalizada,
  ModoBusqueda,
  RespuestaBusquedaPersonalizada,
} from '../products/models/busqueda-personalizada';
import { Veredicto, VeredictoProducto } from '../products/models/compatibilidad';
import { CLAVE_PREFERENCIAS } from './preferencias-busqueda';
import { ErrorApi } from '../products/models/error';
import { Producto } from '../products/models/producto';

function resultado(n: number, cambios: Partial<Producto> = {}): ResultadoBusqueda {
  return {
    score: 10 - n / 100,
    posicion: n,
    producto: {
      codigo_barras: String(7800000000000 + n),
      nombre: `Producto ${n}`,
      marca: null,
      cantidad: null,
      ingredientes_texto: null,
      ingredientes: [],
      alergenos: [],
      trazas: [],
      etiquetas_dieta: [],
      nutriscore: null,
      imagen_url: null,
      procedencia: {
        fuente: 'openfoodfacts',
        url_fuente: 'https://world.openfoodfacts.org/product/1',
        recuperado_en: '2026-10-20T14:30:00Z',
        modificado_en_fuente: null,
        run_id: '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b',
        hash_contenido: 'a'.repeat(64),
      },
      calidad: { es_valido: true, problemas: [], completitud: 1 },
      ...cambios,
    },
  };
}

function rango(desde: number, hasta: number): ResultadoBusqueda[] {
  return Array.from({ length: hasta - desde + 1 }, (_, i) => resultado(desde + i));
}

function respuesta(
  resultados: ResultadoBusqueda[],
  total = resultados.length,
  consulta = 'leche',
  desdeRespaldo = false,
): BusquedaProductos {
  return {
    respuesta: {
      consulta,
      total,
      tiempo_ms: 1,
      resultados,
      estado_fuente: desdeRespaldo ? 'cache' : 'online',
    },
    desdeRespaldo,
  };
}

const AVISO =
  'Clasificación orientativa según tu perfil y los datos de Open Food Facts. No es una garantía de que el producto sea seguro para ti: revisa siempre la etiqueta del envase.';

function veredicto(codigo: string, tipo: Veredicto): VeredictoProducto {
  return {
    codigo_barras: codigo,
    veredicto: tipo,
    alergenos_en_conflicto: [],
    trazas_en_conflicto: [],
    dietas_no_confirmadas: [],
    conflictos: [],
    motivos_no_apto: [],
    datos_suficientes: true,
    explicacion: 'x',
    confianza: 'alta',
    motivos_confianza: [],
    aviso: AVISO,
  };
}

function personalizada(
  tipos: Veredicto[],
  {
    total = tipos.length,
    desde = 1,
    modo = 'filtrar' as ModoBusqueda,
    noAptos = { total: 0, ocultos: true, texto: '' },
    interpretacion = { terminos: ['leche'], restricciones: [], no_reconocidas: [] } as
      RespuestaBusquedaPersonalizada['interpretacion'],
    desdeRespaldo = false,
  } = {},
): BusquedaPersonalizada {
  return {
    respuesta: {
      consulta: 'leche',
      interpretacion,
      perfil_aplicado: { alergias: ['lacteos'], dietas: [], modo_estricto: false },
      modo,
      total,
      total_base: total,
      tiempo_ms: 1,
      estado_fuente: desdeRespaldo ? 'cache' : 'online',
      resultados: tipos.map((tipo, i) => {
        const { producto, score, posicion } = resultado(desde + i);
        return {
          producto,
          score,
          posicion,
          posicion_base: null,
          veredicto: veredicto(producto.codigo_barras, tipo),
        };
      }),
      no_aptos: noAptos,
      comparacion: null,
      aviso: AVISO,
    },
    desdeRespaldo,
  };
}

function errorApi(mensaje: string): ErrorApi {
  return { status: 503, codigo: 'SOURCE_UNAVAILABLE', mensaje, requestId: 'req-1' };
}

describe('BusquedaPage', () => {
  let fixture: ComponentFixture<BusquedaPage>;
  let page: BusquedaPage;
  let buscar: Mock<ProductsService['buscar']>;
  let buscarPersonalizado: Mock<ProductsService['buscarPersonalizado']>;
  let autenticado: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    // La página lee las preferencias guardadas al crearse.
    localStorage.clear();
    buscar = vi.fn<ProductsService['buscar']>();
    buscarPersonalizado = vi.fn<ProductsService['buscarPersonalizado']>();
    autenticado = signal(false);

    await TestBed.configureTestingModule({
      // El módulo de la página trae la barra superior compartida y el router.
      imports: [IonicModule.forRoot(), BusquedaPageModule],
      providers: [
        provideRouter([]),
        { provide: ProductsService, useValue: { buscar, buscarPersonalizado } },
        { provide: AuthService, useValue: { autenticado } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BusquedaPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  function elemento(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function texto(): string {
    return (elemento().textContent ?? '').replace(/\s+/g, ' ');
  }

  function textos(selector: string): string[] {
    return Array.from(elemento().querySelectorAll(selector)).map((e) =>
      (e.textContent ?? '').trim(),
    );
  }

  function botonCargarMas(): HTMLElement | null {
    return elemento().querySelector('ion-button.cargar-mas');
  }

  it('no busca con menos de 2 caracteres y muestra la indicación', () => {
    page.buscar(' l ');

    expect(buscar).not.toHaveBeenCalled();
    expect(texto()).toContain('Escribe al menos 2 caracteres para buscar.');
  });

  it('busca la consulta sin espacios, de a 20 resultados desde el inicio', () => {
    buscar.mockReturnValue(of(respuesta(rango(1, 3))));

    page.buscar('  leche ');

    expect(buscar).toHaveBeenCalledWith('leche', 20, 0);
  });

  it('muestra un spinner mientras espera la respuesta', () => {
    buscar.mockReturnValue(new Subject<BusquedaProductos>());

    page.buscar('leche');

    expect(elemento().querySelector('ion-spinner')).not.toBeNull();
    expect(texto()).not.toContain('Escribe al menos');
  });

  it('muestra el total, el nombre, la marca, la imagen y los alérgenos como chips', () => {
    buscar.mockReturnValue(
      of(
        respuesta(
          [
            resultado(1, {
              nombre: 'Leche semidescremada',
              marca: 'Colun',
              imagen_url: 'https://images.openfoodfacts.org/leche.jpg',
              alergenos: ['lacteos', 'mani'],
            }),
            resultado(2, { nombre: 'Bebida de almendras' }),
          ],
          176,
        ),
      ),
    );

    page.buscar('leche');

    expect(texto()).toContain('176 resultados para «leche»');
    expect(textos('ion-item h2')).toEqual(['Leche semidescremada', 'Bebida de almendras']);
    expect(textos('ion-item .marca')).toEqual(['Colun']);
    expect(elemento().querySelector('ion-thumbnail img')?.getAttribute('src')).toBe(
      'https://images.openfoodfacts.org/leche.jpg',
    );
    expect(elemento().querySelectorAll('ion-thumbnail .sin-imagen')).toHaveLength(1);
    expect(textos('.chip-alergeno')).toEqual(['Lácteos', 'Maní']);
  });

  it('usa el singular con un solo resultado', () => {
    buscar.mockReturnValue(of(respuesta([resultado(1)])));

    page.buscar('leche');

    expect(texto()).toContain('1 resultado para «leche»');
  });

  it('avisa cuando no hay resultados', () => {
    buscar.mockReturnValue(of(respuesta([], 0, 'zzzz')));

    page.buscar('zzzz');

    expect(texto()).toContain('No se encontraron productos para «zzzz».');
    expect(elemento().querySelectorAll('ion-item')).toHaveLength(0);
  });

  it('muestra el mensaje del error del contrato si la búsqueda falla', () => {
    buscar.mockReturnValue(
      throwError(() => errorApi('El servicio de búsqueda no está disponible')),
    );

    page.buscar('leche');

    expect(textos('[role="alert"]')).toEqual(['El servicio de búsqueda no está disponible']);
  });

  it('carga la página siguiente con el offset correcto y la agrega a la lista', () => {
    buscar.mockReturnValueOnce(of(respuesta(rango(1, 20), 25)));
    page.buscar('leche');
    expect(botonCargarMas()?.textContent).toContain('Cargar más (20 de 25)');

    buscar.mockReturnValueOnce(of(respuesta(rango(21, 25), 25)));
    page.cargarMas();

    expect(buscar).toHaveBeenLastCalledWith('leche', 20, 20);
    expect(elemento().querySelectorAll('ion-item')).toHaveLength(25);
    expect(botonCargarMas()).toBeNull();
  });

  it('conserva los resultados y permite reintentar si falla "Cargar más"', () => {
    buscar.mockReturnValueOnce(of(respuesta(rango(1, 20), 25)));
    page.buscar('leche');

    buscar.mockReturnValueOnce(throwError(() => errorApi('Error interno del servicio')));
    page.cargarMas();

    expect(elemento().querySelectorAll('ion-item')).toHaveLength(20);
    expect(textos('[role="alert"]')).toEqual(['Error interno del servicio']);
    expect(botonCargarMas()).not.toBeNull();
  });

  it('descarta la respuesta tardía de una búsqueda anterior', () => {
    const leche = new Subject<BusquedaProductos>();
    const pan = new Subject<BusquedaProductos>();
    buscar.mockReturnValueOnce(leche).mockReturnValueOnce(pan);

    page.buscar('leche');
    page.buscar('pan');
    pan.next(respuesta([resultado(1, { nombre: 'Pan integral' })], 1, 'pan'));
    leche.next(respuesta([resultado(2, { nombre: 'Leche entera' })]));

    expect(textos('ion-item h2')).toEqual(['Pan integral']);
  });

  it('ignora "Cargar más" de una consulta que el usuario ya cambió', () => {
    const masLeche = new Subject<BusquedaProductos>();
    buscar
      .mockReturnValueOnce(of(respuesta(rango(1, 20), 25)))
      .mockReturnValueOnce(masLeche)
      .mockReturnValueOnce(of(respuesta([resultado(1, { nombre: 'Pan integral' })], 1, 'pan')));

    page.buscar('leche');
    page.cargarMas();
    page.buscar('pan');
    masLeche.next(respuesta(rango(21, 25), 25));

    expect(textos('ion-item h2')).toEqual(['Pan integral']);
  });

  describe('aviso de respaldo', () => {
    const AVISO =
      'El servicio de búsqueda no está disponible; mostrando productos guardados anteriormente.';

    function aviso(): string[] {
      return textos('.aviso-respaldo[role="status"]').map((t) => t.replace(/\s+/g, ' '));
    }

    it('lo muestra si los resultados vienen del respaldo', () => {
      buscar.mockReturnValue(of(respuesta(rango(1, 3), 3, 'leche', true)));

      page.buscar('leche');

      expect(aviso()).toEqual([AVISO]);
      expect(elemento().querySelectorAll('ion-item')).toHaveLength(3);
    });

    it('no lo muestra si los resultados vienen de FastAPI', () => {
      buscar.mockReturnValue(of(respuesta(rango(1, 3))));

      page.buscar('leche');

      expect(aviso()).toEqual([]);
    });

    it('lo muestra si "Cargar más" vino del respaldo y lo mantiene', () => {
      buscar
        .mockReturnValueOnce(of(respuesta(rango(1, 20), 45)))
        .mockReturnValueOnce(of(respuesta(rango(21, 40), 45, 'leche', true)))
        .mockReturnValueOnce(of(respuesta(rango(41, 45), 45)));

      page.buscar('leche');
      expect(aviso()).toEqual([]);

      page.cargarMas();
      expect(aviso()).toEqual([AVISO]);

      page.cargarMas();
      expect(aviso()).toEqual([AVISO]);
    });

    it('lo quita con una búsqueda nueva que viene de FastAPI', () => {
      buscar
        .mockReturnValueOnce(of(respuesta(rango(1, 3), 3, 'leche', true)))
        .mockReturnValueOnce(of(respuesta(rango(1, 2), 2, 'pan')));

      page.buscar('leche');
      expect(aviso()).toEqual([AVISO]);

      page.buscar('pan');
      expect(aviso()).toEqual([]);
    });
  });

  describe('aviso "Despertando el servidor…"', () => {
    afterEach(() => vi.useRealTimers());

    const despertando = () => texto().includes('Despertando el servidor…');

    it('aparece si la búsqueda tarda más de 5 s y se quita al responder', () => {
      vi.useFakeTimers();
      const respuestaLenta = new Subject<BusquedaProductos>();
      buscar.mockReturnValue(respuestaLenta);

      page.buscar('leche');
      vi.advanceTimersByTime(4999);
      expect(despertando()).toBe(false);

      vi.advanceTimersByTime(1);
      expect(despertando()).toBe(true);

      respuestaLenta.next(respuesta(rango(1, 3)));
      respuestaLenta.complete();
      expect(despertando()).toBe(false);
      expect(elemento().querySelectorAll('ion-item')).toHaveLength(3);
    });

    it('no aparece si la búsqueda responde antes de 5 s', () => {
      vi.useFakeTimers();
      buscar.mockReturnValue(of(respuesta(rango(1, 3))));

      page.buscar('leche');
      vi.advanceTimersByTime(6000);

      expect(despertando()).toBe(false);
    });

    it('se reinicia si el usuario cambia la consulta', () => {
      vi.useFakeTimers();
      buscar.mockReturnValue(new Subject<BusquedaProductos>());

      page.buscar('leche');
      vi.advanceTimersByTime(4000);
      page.buscar('pan');
      vi.advanceTimersByTime(4000);

      expect(despertando()).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(despertando()).toBe(true);
    });
  });

  describe('búsqueda personalizada según el perfil', () => {
    const interruptor = () => elemento().querySelector('ion-toggle.personalizar');
    const segmento = () => elemento().querySelector('ion-segment.modo');
    const chips = () => textos('.chip-veredicto');
    const guardadas = () => JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) ?? 'null');

    function recrear(): void {
      fixture.destroy();
      fixture = TestBed.createComponent(BusquedaPage);
      page = fixture.componentInstance;
      fixture.detectChanges();
    }

    describe('sin sesión', () => {
      it('no muestra el interruptor e invita a iniciar sesión', () => {
        expect(interruptor()).toBeNull();
        expect(segmento()).toBeNull();
        expect(texto()).toContain(
          'Inicia sesión para personalizar la búsqueda según tus alergias.',
        );
        expect(elemento().querySelector('.invitar-sesion a')?.getAttribute('href')).toBe(
          '/login',
        );
      });

      it('busca con /search aunque la preferencia guardada sea personalizar', () => {
        localStorage.setItem(
          CLAVE_PREFERENCIAS,
          JSON.stringify({ personalizar: true, modo: 'filtrar' }),
        );
        recrear();
        buscar.mockReturnValue(of(respuesta(rango(1, 3))));

        page.buscar('leche');

        expect(buscar).toHaveBeenCalledWith('leche', 20, 0);
        expect(buscarPersonalizado).not.toHaveBeenCalled();
        expect(chips()).toEqual([]);
      });
    });

    describe('con sesión', () => {
      beforeEach(() => autenticado.set(true));

      it('muestra el interruptor apagado, con aria-label, y busca con /search', () => {
        buscar.mockReturnValue(of(respuesta(rango(1, 3))));

        page.buscar('leche');

        expect(interruptor()?.textContent?.trim()).toBe('Personalizar según mi perfil');
        expect(interruptor()?.getAttribute('aria-label')).toBe('Personalizar según mi perfil');
        expect(segmento()).toBeNull();
        expect(elemento().querySelector('.invitar-sesion')).toBeNull();
        expect(buscar).toHaveBeenCalledWith('leche', 20, 0);
        expect(buscarPersonalizado).not.toHaveBeenCalled();
        expect(elemento().querySelector('.aviso-orientativo')).toBeNull();
      });

      it('al activarlo repite la consulta personalizada en modo filtrar y lo recuerda', () => {
        buscar.mockReturnValue(of(respuesta(rango(1, 3))));
        page.buscar('leche');
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto', 'apto_con_advertencia'])));

        page.cambiarPersonalizar(true);

        expect(buscarPersonalizado).toHaveBeenCalledWith('leche', 'filtrar', 20, 0);
        expect(guardadas()).toEqual({ personalizar: true, modo: 'filtrar' });
        expect(segmento()?.getAttribute('aria-label')).toBe(
          'Qué hacer con los productos no aptos',
        );
        expect(textos('ion-segment-button')).toEqual(['Ocultar no aptos', 'Mostrar al final']);
        expect(texto()).toContain('2 resultados para «leche», según tu perfil');
      });

      it('muestra el veredicto de cada resultado con ícono y texto', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(
          of(personalizada(['apto', 'apto_con_advertencia', 'no_apto'], { modo: 'reordenar' })),
        );

        page.buscar('leche');

        expect(chips()).toEqual(['Apto', 'Con advertencia', 'No apto']);
        const clases = Array.from(elemento().querySelectorAll('.chip-veredicto')).map((c) =>
          ['apto', 'apto-con-advertencia', 'no-apto'].find((k) => c.classList.contains(k)),
        );
        expect(clases).toEqual(['apto', 'apto-con-advertencia', 'no-apto']);
        expect(elemento().querySelectorAll('.chip-veredicto ion-icon[aria-hidden="true"]')).toHaveLength(3);
      });

      it('"Mostrar al final" repite la consulta en modo reordenar y lo recuerda', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto'])));
        page.buscar('leche');

        page.cambiarModo('reordenar');

        expect(buscarPersonalizado).toHaveBeenLastCalledWith('leche', 'reordenar', 20, 0);
        expect(guardadas()).toEqual({ personalizar: true, modo: 'reordenar' });
      });

      it('ignora un modo inválido', () => {
        page.cambiarModo('otro');

        expect(page.modo()).toBe('filtrar');
        expect(localStorage.getItem(CLAVE_PREFERENCIAS)).toBeNull();
      });

      it('recuerda la elección guardada al volver a la página', () => {
        localStorage.setItem(
          CLAVE_PREFERENCIAS,
          JSON.stringify({ personalizar: true, modo: 'reordenar' }),
        );
        recrear();
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto'])));

        page.buscar('leche');

        expect(buscarPersonalizado).toHaveBeenCalledWith('leche', 'reordenar', 20, 0);
        expect(buscar).not.toHaveBeenCalled();
      });

      it('funciona aunque localStorage falle', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new Error('bloqueado');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new Error('bloqueado');
        });
        recrear();
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto'])));

        page.cambiarPersonalizar(true);
        page.buscar('leche');

        expect(buscarPersonalizado).toHaveBeenCalledWith('leche', 'filtrar', 20, 0);
        vi.restoreAllMocks();
      });

      it('muestra qué se ocultó y por qué, y el aviso orientativo', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(
          of(
            personalizada(['apto'], {
              noAptos: { total: 3, ocultos: true, texto: '3 ocultos por contener lácteos.' },
            }),
          ),
        );

        page.buscar('leche');

        expect(textos('.no-aptos[role="status"]')).toEqual(['3 ocultos por contener lácteos.']);
        expect(textos('.aviso-orientativo[role="status"]')).toEqual([AVISO]);
      });

      it('sin no aptos no muestra el resumen, pero sí el aviso', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto'])));

        page.buscar('leche');

        expect(elemento().querySelector('.no-aptos')).toBeNull();
        expect(textos('.aviso-orientativo')).toEqual([AVISO]);
      });

      it('si todo quedó oculto, lo explica junto al mensaje de sin resultados', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(
          of(
            personalizada([], {
              noAptos: { total: 2, ocultos: true, texto: '2 ocultos por contener lácteos.' },
            }),
          ),
        );

        page.buscar('leche');

        expect(texto()).toContain('No se encontraron productos para «leche» según tu perfil.');
        expect(textos('.no-aptos')).toEqual(['2 ocultos por contener lácteos.']);
        expect(textos('.aviso-orientativo')).toEqual([AVISO]);
      });

      it('muestra cómo se interpretó la consulta y lo que no se reconoció', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(
          of(
            personalizada(['apto'], {
              interpretacion: {
                terminos: ['chocolate', 'azucar'],
                restricciones: [{ texto: 'sin leche', tipo: 'alergeno', codigo: 'lacteos' }],
                no_reconocidas: ['sin azúcar'],
              },
            }),
          ),
        );

        page.buscar('chocolate sin leche sin azúcar');

        expect(textos('.interpretacion').map((t) => t.replace(/\s+/g, ' '))).toEqual([
          'Buscamos «chocolate azucar» sin lácteos (por «sin leche»).',
          'No reconocimos «sin azúcar» como alérgeno ni dieta: se buscó como texto.',
        ]);
      });

      it('sin restricciones en la consulta no muestra la interpretación', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto'])));

        page.buscar('leche');

        expect(elemento().querySelector('.interpretacion')).toBeNull();
      });

      it('"Cargar más" usa la búsqueda personalizada con el mismo modo', () => {
        page.cambiarPersonalizar(true);
        page.cambiarModo('reordenar');
        buscarPersonalizado.mockReturnValueOnce(
          of(personalizada(Array(20).fill('apto'), { total: 21, modo: 'reordenar' })),
        );
        page.buscar('leche');

        buscarPersonalizado.mockReturnValueOnce(
          of(personalizada(['no_apto'], { total: 21, desde: 21, modo: 'reordenar' })),
        );
        page.cargarMas();

        expect(buscarPersonalizado).toHaveBeenLastCalledWith('leche', 'reordenar', 20, 20);
        expect(buscar).not.toHaveBeenCalled();
        expect(elemento().querySelectorAll('ion-item')).toHaveLength(21);
        expect(chips().at(-1)).toBe('No apto');
      });

      it('indica la revisión básica si la personalizada vino del respaldo', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(
          of(personalizada(['apto_con_advertencia'], { desdeRespaldo: true })),
        );

        page.buscar('leche');

        expect(
          textos('.aviso-respaldo[role="status"]').map((t) => t.replace(/\s+/g, ' ')),
        ).toEqual([
          'El servicio de evaluación no está disponible: revisión básica con productos guardados anteriormente.',
        ]);
      });

      it('al desactivarlo vuelve a /search, sin chips ni aviso, y lo recuerda', () => {
        page.cambiarPersonalizar(true);
        buscarPersonalizado.mockReturnValue(of(personalizada(['apto'])));
        page.buscar('leche');

        buscar.mockReturnValue(of(respuesta(rango(1, 5))));
        page.cambiarPersonalizar(false);

        expect(buscar).toHaveBeenCalledWith('leche', 20, 0);
        expect(elemento().querySelectorAll('ion-item')).toHaveLength(5);
        expect(chips()).toEqual([]);
        expect(elemento().querySelector('.aviso-orientativo')).toBeNull();
        expect(guardadas()).toEqual({ personalizar: false, modo: 'filtrar' });
      });

      it('descarta la respuesta tardía de la búsqueda anterior al cambiar de modo', () => {
        const filtrar = new Subject<BusquedaPersonalizada>();
        page.cambiarPersonalizar(true);
        buscarPersonalizado
          .mockReturnValueOnce(filtrar)
          .mockReturnValueOnce(of(personalizada(['no_apto'], { modo: 'reordenar' })));

        page.buscar('leche');
        page.cambiarModo('reordenar');
        filtrar.next(personalizada(['apto', 'apto']));

        expect(chips()).toEqual(['No apto']);
      });
    });
  });

  it('cada resultado enlaza al detalle del producto', () => {
    buscar.mockReturnValue(of(respuesta([resultado(1)])));

    page.buscar('leche');
    fixture.detectChanges();

    const enlace = fixture.debugElement
      .query(By.css('ion-item'))
      .injector.get(RouterLink);
    expect(enlace.urlTree?.toString()).toBe('/producto/7800000000001');
  });
});
