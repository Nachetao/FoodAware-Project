import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AlertController,
  IonicModule,
  LoadingController,
} from '@ionic/angular/lazy';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { HomePage } from './home.page';
import { HomePageModule } from './home.module';
import { AuthService } from '../auth/auth.service';
import { AnalisisService, ResultadoAnalisis } from '../analisis/analisis.service';
import { ErrorApi } from '../products/models/error';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  let analizar: ReturnType<typeof vi.fn<AnalisisService['analizar']>>;
  let crearAlerta: ReturnType<typeof vi.fn>;
  let cerrarCarga: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    analizar = vi.fn<AnalisisService['analizar']>();
    crearAlerta = vi.fn().mockResolvedValue({ present: vi.fn() });
    cerrarCarga = vi.fn().mockResolvedValue(true);

    await TestBed.configureTestingModule({
      // El módulo de la página trae FormsModule y la barra superior compartida.
      imports: [IonicModule.forRoot(), HomePageModule],
      providers: [
        provideRouter([]),
        { provide: AnalisisService, useValue: { analizar } },
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('botón "Analizar"', () => {
    // Simula lo que hace Ionic al escribir: actualiza value y emite ionInput.
    function escribir(selector: string, texto: string) {
      const el = fixture.nativeElement.querySelector(selector) as HTMLElement & { value: string };
      el.value = texto;
      el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: texto } }));
    }

    function botonAnalizar(): HTMLElement & { disabled: boolean } {
      return fixture.nativeElement.querySelector('ion-button.ion-margin-top');
    }

    it('empieza deshabilitado', async () => {
      await fixture.whenStable();
      expect(botonAnalizar().disabled).toBe(true);
    });

    it('se habilita al escribir en ambos campos, sin detectChanges manual', async () => {
      escribir('ion-input', 'Barrita energética');
      await fixture.whenStable();
      expect(component.productoNombre).toBe('Barrita energética');
      expect(botonAnalizar().disabled).toBe(true);

      escribir('ion-textarea', 'avena, maní');
      await fixture.whenStable();

      expect(component.ingredientesTexto).toBe('avena, maní');
      expect(botonAnalizar().disabled).toBe(false);
    });

    it('vuelve a deshabilitarse si un campo queda solo con espacios', async () => {
      escribir('ion-input', 'Barrita');
      escribir('ion-textarea', 'avena');
      await fixture.whenStable();

      escribir('ion-textarea', '   ');
      await fixture.whenStable();

      expect(botonAnalizar().disabled).toBe(true);
    });
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

    const texto = () => {
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).textContent ?? '';
    };

    it('envía los ingredientes separados y muestra el resultado', async () => {
      analizar.mockReturnValue(of(resultado));
      component.productoNombre = '  Barrita energética ';
      component.ingredientesTexto = 'avena, , maní ';

      await component.analizarProducto();

      expect(analizar).toHaveBeenCalledWith('Barrita energética', ['avena', 'maní']);
      expect(cerrarCarga).toHaveBeenCalled();
      expect(component.resultado()).toEqual(resultado);
      expect(component.error()).toBe('');
      expect(texto()).toContain('Barrita energética');
      expect(texto()).toContain('Alérgenos detectados:');
      expect(texto()).toContain('maní');
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
      expect(texto()).toContain('No se pudo conectar con el servidor.');
    });

    it('limpia el error anterior al volver a analizar', async () => {
      component.error.set('Error previo');
      analizar.mockReturnValue(of(resultado));
      component.productoNombre = 'Barrita';
      component.ingredientesTexto = 'avena';

      await component.analizarProducto();

      expect(component.error()).toBe('');
      expect(texto()).not.toContain('Error previo');
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

  describe('toolbar según la sesión', () => {
    const toolbar = () => {
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('sin sesión muestra "Ingresar"', () => {
      expect(toolbar().querySelector('ion-button.ingresar')?.textContent?.trim()).toBe('Ingresar');
      expect(toolbar().querySelector('ion-button[aria-label="Mi perfil"]')).toBeNull();
    });

    it('con sesión muestra el ícono de perfil', () => {
      TestBed.inject(AuthService).token.set('jwt-1');

      expect(toolbar().querySelector('ion-button[aria-label="Mi perfil"]')).not.toBeNull();
      expect(toolbar().querySelector('ion-button.ingresar')).toBeNull();
    });
  });
});
