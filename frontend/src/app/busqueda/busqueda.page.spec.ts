import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterLink, RouterModule, provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Subject, of, throwError } from 'rxjs';
import type { Mock } from 'vitest';

import { BusquedaPage } from './busqueda.page';
import { ProductsService } from '../products/products.service';
import { BusquedaProductos, ResultadoBusqueda } from '../products/models/busqueda';
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

function errorApi(mensaje: string): ErrorApi {
  return { status: 503, codigo: 'SOURCE_UNAVAILABLE', mensaje, requestId: 'req-1' };
}

describe('BusquedaPage', () => {
  let fixture: ComponentFixture<BusquedaPage>;
  let page: BusquedaPage;
  let buscar: Mock<ProductsService['buscar']>;

  beforeEach(async () => {
    buscar = vi.fn<ProductsService['buscar']>();

    await TestBed.configureTestingModule({
      declarations: [BusquedaPage],
      imports: [IonicModule.forRoot(), RouterModule],
      providers: [provideRouter([]), { provide: ProductsService, useValue: { buscar } }],
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
