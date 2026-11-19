import { Component, DebugElement, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import {
  AlertController,
  IonicModule,
  LoadingController,
} from '@ionic/angular/lazy';
import { of, throwError } from 'rxjs';

import { HomePage } from './home.page';
import { HomePageModule } from './home.module';
import { AuthService } from '../auth/auth.service';
import { AnalisisService, ResultadoAnalisis } from '../analisis/analisis.service';
import { CLAVE_PREFERENCIAS, leerPreferencias } from '../busqueda/preferencias-busqueda';
import { AVISO_ORIENTATIVO } from '../compartido/aviso-orientativo';
import { ErrorApi } from '../products/models/error';
import { InstalacionService } from '../pwa/instalacion.service';

@Component({ template: '' })
class VaciaPage {}

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  let autenticado: ReturnType<typeof signal<boolean>>;
  let analizar: ReturnType<typeof vi.fn<AnalisisService['analizar']>>;
  let crearAlerta: ReturnType<typeof vi.fn>;
  let cerrarCarga: ReturnType<typeof vi.fn>;
  let instalacion: { disponible: ReturnType<typeof signal<boolean>>; instalar: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    localStorage.clear();
    autenticado = signal(false);
    analizar = vi.fn<AnalisisService['analizar']>();
    crearAlerta = vi.fn().mockResolvedValue({ present: vi.fn() });
    cerrarCarga = vi.fn().mockResolvedValue(true);
    instalacion = { disponible: signal(false), instalar: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      // El módulo de la página trae FormsModule y la barra superior compartida.
      imports: [IonicModule.forRoot(), HomePageModule],
      providers: [
        provideRouter([
          { path: 'busqueda', component: VaciaPage },
          { path: 'metricas', component: VaciaPage },
          { path: 'perfil', component: VaciaPage },
          { path: 'login', component: VaciaPage },
        ]),
        { provide: AuthService, useValue: { autenticado, esAdmin: signal(false) } },
        { provide: AnalisisService, useValue: { analizar } },
        { provide: InstalacionService, useValue: instalacion },
        { provide: AlertController, useValue: { create: crearAlerta } },
        {
          provide: LoadingController,
          useValue: {
            create: vi.fn().mockResolvedValue({
              present: vi.fn(),
              dismiss: cerrarCarga,
            }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const raiz = () => {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const texto = (selector: string) =>
    (raiz().querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Ionic quita del DOM los atributos aria de sus componentes al cargar:
  // DebugElement.attributes los devuelve tal como los declara la plantilla.
  const query = (selector: string) => {
    fixture.detectChanges();
    return fixture.debugElement.queryAll(By.css(selector));
  };
  const etiqueta = (de: DebugElement) => de.attributes['aria-label'] ?? null;
  const urlActual = async () => {
    await fixture.whenStable();
    return TestBed.inject(Router).url;
  };

  // Simula lo que hace Ionic al escribir: actualiza value y emite ionInput.
  function escribir(selector: string, valor: string) {
    const el = raiz().querySelector(selector) as HTMLElement & { value: string };
    el.value = valor;
    el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: valor } }));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('usa la barra compartida con el título "FoodAware" y sin botón volver', () => {
    expect(texto('app-barra-superior ion-title')).toBe('FoodAware');
    expect(raiz().querySelector('ion-back-button')).toBeNull();
  });

  it('presenta la aplicación con un h1 y una línea', () => {
    expect(texto('.presentacion h1')).toBe('FoodAware');
    expect(texto('.presentacion p')).toBe(
      'Busca alimentos y descubre si son aptos para ti según tus alergias. Para personas con alergias, intolerancias o dietas.',
    );
  });

  describe('instalar la app', () => {
    const botonInstalar = () => raiz().querySelector<HTMLElement>('.presentacion ion-button.instalar');

    it('no muestra el botón si el navegador no permite instalar', () => {
      expect(botonInstalar()).toBeNull();
    });

    it('con la instalación disponible muestra "Instalar FoodAware" y la inicia', () => {
      instalacion.disponible.set(true);

      expect(botonInstalar()?.textContent?.trim()).toBe('Instalar FoodAware');
      botonInstalar()!.click();

      expect(instalacion.instalar).toHaveBeenCalled();
    });
  });

  describe('buscador principal', () => {
    const enviar = () =>
      raiz().querySelector('form.buscador')!.dispatchEvent(new Event('submit'));

    it('es un formulario de búsqueda con campo etiquetado y botón "Buscar"', () => {
      expect(raiz().querySelector('form.buscador')?.getAttribute('role')).toBe('search');
      const [campo] = query('form.buscador ion-input');
      expect(etiqueta(campo)).toBe('Buscar alimentos');
      const [boton] = query('form.buscador ion-button');
      expect(boton.attributes['type']).toBe('submit');
      expect((boton.nativeElement as HTMLElement).textContent?.trim()).toBe('Buscar');
    });

    it('lleva a /busqueda con la consulta sin espacios en ?q=', async () => {
      escribir('form.buscador ion-input', '  leche sin lactosa ');
      await fixture.whenStable();

      enviar();

      expect(await urlActual()).toBe('/busqueda?q=leche%20sin%20lactosa');
    });

    it('sin texto lleva a /busqueda sin consulta', async () => {
      escribir('form.buscador ion-input', '   ');
      await fixture.whenStable();

      enviar();

      expect(await urlActual()).toBe('/busqueda');
    });
  });

  describe('accesos según la sesión', () => {
    const href = (selector: string) => raiz().querySelector(selector)?.getAttribute('href');

    it('sin sesión invita a iniciar sesión para personalizar', () => {
      expect(texto('.acceso.iniciar-sesion .acceso-titulo')).toBe('Inicia sesión para personalizar');
      expect(href('.acceso.iniciar-sesion')).toBe('/login');
      expect(raiz().querySelector('.acceso.personalizar')).toBeNull();
      expect(raiz().querySelector('.editar-alergias')).toBeNull();
    });

    it('con sesión ofrece personalizar y editar las alergias', () => {
      autenticado.set(true);

      expect(texto('.acceso.personalizar .acceso-titulo')).toBe('Personalizar según mi perfil');
      expect(texto('.editar-alergias')).toBe('Editar mis alergias');
      expect(href('.editar-alergias')).toBe('/perfil');
      expect(raiz().querySelector('.acceso.iniciar-sesion')).toBeNull();
    });

    it('"Personalizar según mi perfil" activa la preferencia, conserva el modo y va a /busqueda', async () => {
      localStorage.setItem(
        CLAVE_PREFERENCIAS,
        JSON.stringify({ personalizar: false, modo: 'reordenar' }),
      );
      autenticado.set(true);

      (raiz().querySelector('.acceso.personalizar') as HTMLButtonElement).click();

      expect(leerPreferencias()).toEqual({ personalizar: true, modo: 'reordenar' });
      expect(await urlActual()).toBe('/busqueda');
    });

    it.each([false, true])('el acceso a métricas está siempre (sesión: %s)', (sesion) => {
      autenticado.set(sesion);

      expect(texto('.acceso.metricas .acceso-titulo')).toBe('Métricas');
      expect(texto('.acceso.metricas .acceso-frase')).toBe('Calidad de los datos y de la búsqueda.');
      expect(href('.acceso.metricas')).toBe('/metricas');
    });
  });

  describe('accesibilidad', () => {
    it.each([false, true])('los íconos de la página son decorativos (sesión: %s)', async (sesion) => {
      autenticado.set(sesion);
      component.productoNombre = 'Barrita';
      component.ingredientesTexto = 'maní';
      analizar.mockReturnValue(
        of({
          id: 'f-1',
          nombre: 'Barrita',
          ingredientes: ['maní'],
          alergenosPresentes: ['maní'],
          esNutricionalmenteSaludable: false,
          aptoParaConsumo: false,
        }),
      );
      // Con el resultado a la vista, para revisar también sus íconos.
      await component.analizarProducto();

      const iconos = query('.contenedor ion-icon');
      expect(iconos.length).toBeGreaterThanOrEqual(9);
      for (const icono of iconos) {
        expect(icono.attributes['aria-hidden']).toBe('true');
      }
    });

    it.each([false, true])('cada botón tiene texto o aria-label (sesión: %s)', (sesion) => {
      autenticado.set(sesion);

      const botones = query('.contenedor ion-button, .contenedor button, .contenedor a');
      expect(botones.length).toBeGreaterThan(0);
      for (const boton of botones) {
        const nombre =
          etiqueta(boton) ?? (boton.nativeElement as HTMLElement).textContent?.trim();
        expect(nombre).toBeTruthy();
      }
    });
  });

  describe('aviso orientativo', () => {
    it('muestra siempre el aviso del motor como estado', () => {
      const aviso = raiz().querySelector('.aviso-orientativo');
      expect(aviso?.getAttribute('role')).toBe('status');
      expect(texto('.aviso-orientativo')).toBe(AVISO_ORIENTATIVO);
    });

    it('el texto compartido es el mismo que devuelve el motor', () => {
      expect(AVISO_ORIENTATIVO).toBe(
        'Clasificación orientativa según tu perfil y los datos de Open Food Facts. No es una garantía de que el producto sea seguro para ti: revisa siempre la etiqueta del envase.',
      );
    });
  });

  it('el pie atribuye los datos a Open Food Facts', () => {
    expect(texto('footer.pie')).toBe('Datos de Open Food Facts (ODbL)');
  });

  describe('análisis de ingredientes', () => {
    const resultado: ResultadoAnalisis = {
      id: 'f-1',
      nombre: 'Barrita energética',
      ingredientes: ['avena', 'maní'],
      alergenosPresentes: ['maní'],
      esNutricionalmenteSaludable: true,
      aptoParaConsumo: false,
    };

    const contenido = () => texto('.analisis');

    function botonAnalizar(): HTMLElement & { disabled: boolean } {
      return raiz().querySelector('.analisis ion-button.analizar')!;
    }

    it('es una sección secundaria con su título', () => {
      expect(texto('.analisis h2')).toBe('¿No encuentras el producto? Analiza sus ingredientes');
    });

    it('el botón "Analizar" empieza deshabilitado', async () => {
      await fixture.whenStable();
      expect(botonAnalizar().disabled).toBe(true);
    });

    it('se habilita al escribir en ambos campos, sin detectChanges manual', async () => {
      escribir('.analisis ion-input', 'Barrita energética');
      await fixture.whenStable();
      expect(component.productoNombre).toBe('Barrita energética');
      expect(botonAnalizar().disabled).toBe(true);

      escribir('.analisis ion-textarea', 'avena, maní');
      await fixture.whenStable();

      expect(component.ingredientesTexto).toBe('avena, maní');
      expect(botonAnalizar().disabled).toBe(false);
    });

    it('vuelve a deshabilitarse si un campo queda solo con espacios', async () => {
      escribir('.analisis ion-input', 'Barrita');
      escribir('.analisis ion-textarea', 'avena');
      await fixture.whenStable();

      escribir('.analisis ion-textarea', '   ');
      await fixture.whenStable();

      expect(botonAnalizar().disabled).toBe(true);
    });

    it('envía los ingredientes separados y muestra el resultado', async () => {
      analizar.mockReturnValue(of(resultado));
      component.productoNombre = '  Barrita energética ';
      component.ingredientesTexto = 'avena, , maní ';

      await component.analizarProducto();

      expect(analizar).toHaveBeenCalledWith('Barrita energética', ['avena', 'maní']);
      expect(cerrarCarga).toHaveBeenCalled();
      expect(component.resultado()).toEqual(resultado);
      expect(component.error()).toBe('');
      expect(contenido()).toContain('Barrita energética');
      expect(contenido()).toContain('Alérgenos detectados: maní');
    });

    it('muestra el mensaje del ErrorApi si el análisis falla', async () => {
      const error: ErrorApi = {
        status: 0,
        codigo: null,
        mensaje: 'No se pudo conectar con el servidor.',
        requestId: null,
      };
      analizar.mockReturnValue(throwError(() => error));
      component.productoNombre = 'Barrita';
      component.ingredientesTexto = 'avena';

      await component.analizarProducto();

      expect(cerrarCarga).toHaveBeenCalled();
      expect(component.resultado()).toBeNull();
      expect(component.error()).toBe('No se pudo conectar con el servidor.');
      expect(contenido()).toContain('No se pudo conectar con el servidor.');
    });

    it('limpia el error anterior al volver a analizar', async () => {
      component.error.set('Error previo');
      analizar.mockReturnValue(of(resultado));
      component.productoNombre = 'Barrita';
      component.ingredientesTexto = 'avena';

      await component.analizarProducto();

      expect(component.error()).toBe('');
      expect(contenido()).not.toContain('Error previo');
    });

    it('avisa y no analiza si falta un campo', async () => {
      component.productoNombre = '   ';
      component.ingredientesTexto = 'avena';

      await component.analizarProducto();

      expect(crearAlerta).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Campos requeridos' }),
      );
      expect(analizar).not.toHaveBeenCalled();
    });

    it('avisa y no analiza si no queda ningún ingrediente al separar', async () => {
      component.productoNombre = 'Barrita';
      component.ingredientesTexto = ' , ,';

      await component.analizarProducto();

      expect(crearAlerta).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Ingredientes inválidos' }),
      );
      expect(analizar).not.toHaveBeenCalled();
    });
  });

  describe('barra superior según la sesión', () => {
    const etiquetasBarra = () => query('app-barra-superior ion-button').map(etiqueta);

    it('sin sesión muestra "Ingresar" y no "Mi perfil"', () => {
      expect(etiquetasBarra()).toContain('Ingresar');
      expect(etiquetasBarra()).not.toContain('Mi perfil');
    });

    it('con sesión muestra "Mi perfil" y no "Ingresar"', () => {
      autenticado.set(true);

      expect(etiquetasBarra()).toContain('Mi perfil');
      expect(etiquetasBarra()).not.toContain('Ingresar');
    });
  });
});
