import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular/lazy';
import { CompartidoModule } from './compartido.module';
import { CargandoComponent } from './cargando.component';
import { SELECTOR_BOTON_LIMPIAR } from './etiqueta-limpiar.directive';
import { movimientoReducido } from './movimiento';

// Los MutationObserver avisan en una microtarea.
const microtarea = () => new Promise<void>((listo) => queueMicrotask(listo));

describe('CargandoComponent', () => {
  let fixture: ComponentFixture<CargandoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), CompartidoModule],
    }).compileComponents();
    fixture = TestBed.createComponent(CargandoComponent);
    fixture.componentRef.setInput('texto', 'Buscando productos…');
    fixture.detectChanges();
  });

  it('anuncia qué carga en una región de estado, con el spinner solo visual', () => {
    const region = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')!;

    expect(region.querySelector('.solo-lectores')?.textContent).toBe('Buscando productos…');
    expect(region.querySelector('ion-spinner')?.getAttribute('aria-hidden')).toBe('true');
  });
});

@Component({
  template: `
    @if (visible()) {
      <ion-searchbar appEtiquetaLimpiar="Limpiar búsqueda"></ion-searchbar>
    }
  `,
  imports: [IonicModule, CompartidoModule],
})
class BuscadorPage {
  readonly visible = signal(true);
}

describe('EtiquetaLimpiarDirective', () => {
  let fixture: ComponentFixture<BuscadorPage>;

  // Lo que dibuja Ionic dentro de ion-searchbar (en jsdom no se hidrata).
  function dibujarBotonDeIonic(): HTMLButtonElement {
    const buscador = (fixture.nativeElement as HTMLElement).querySelector('ion-searchbar')!;
    const boton = document.createElement('button');
    boton.className = 'searchbar-clear-button';
    boton.setAttribute('aria-label', 'reset');
    buscador.querySelector(SELECTOR_BOTON_LIMPIAR)?.remove();
    buscador.appendChild(boton);
    return boton;
  }
  const etiqueta = () =>
    (fixture.nativeElement as HTMLElement).querySelector(SELECTOR_BOTON_LIMPIAR)?.getAttribute('aria-label');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [IonicModule.forRoot(), BuscadorPage] }).compileComponents();
    fixture = TestBed.createComponent(BuscadorPage);
    fixture.detectChanges();
  });

  it('pone en español el nombre del botón que Ionic dibuja después', async () => {
    dibujarBotonDeIonic();
    await microtarea();

    expect(etiqueta()).toBe('Limpiar búsqueda');
  });

  it('lo corrige otra vez si Ionic vuelve a hidratar el buscador y crea el botón de nuevo', async () => {
    dibujarBotonDeIonic();
    await microtarea();

    dibujarBotonDeIonic();
    await microtarea();

    expect(etiqueta()).toBe('Limpiar búsqueda');
  });

  it('lo corrige si Ionic le devuelve aria-label="reset"', async () => {
    const boton = dibujarBotonDeIonic();
    await microtarea();

    boton.setAttribute('aria-label', 'reset');
    await microtarea();

    expect(etiqueta()).toBe('Limpiar búsqueda');
  });

  it('deja de observar al destruirse', async () => {
    const buscador = (fixture.nativeElement as HTMLElement).querySelector('ion-searchbar')!;
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();

    const boton = document.createElement('button');
    boton.className = 'searchbar-clear-button';
    boton.setAttribute('aria-label', 'reset');
    buscador.appendChild(boton);
    await microtarea();

    expect(boton.getAttribute('aria-label')).toBe('reset');
  });
});

describe('movimientoReducido', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([true, false])('sigue la preferencia del sistema (reducir: %s)', (reducir) => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reducir } as MediaQueryList);

    expect(movimientoReducido()).toBe(reducir);
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('sin matchMedia no reduce nada', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(() => {
      throw new Error('no disponible');
    });

    expect(movimientoReducido()).toBe(false);
  });
});
