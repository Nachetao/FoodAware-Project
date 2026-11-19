import { Component, DebugElement, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, RouterLinkActive, provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';

import { AuthService } from '../auth/auth.service';
import { CompartidoModule } from './compartido.module';

@Component({
  template: `
    <app-barra-superior [titulo]="titulo()" [atras]="atras()">
      @if (conExtra()) {
        <ion-button accionExtra aria-label="Actualizar métricas">Actualizar</ion-button>
      }
    </app-barra-superior>
  `,
  // Los tests se compilan AOT: el anfitrión declara lo que usa su plantilla.
  imports: [CompartidoModule, IonicModule],
})
class PruebaPage {
  readonly titulo = signal('Métricas');
  readonly atras = signal<string | null>('/home');
  readonly conExtra = signal(false);
}

@Component({ template: '' })
class VaciaPage {}

describe('BarraSuperiorComponent', () => {
  let fixture: ComponentFixture<PruebaPage>;
  let autenticado: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    autenticado = signal(false);
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), PruebaPage],
      providers: [
        provideRouter([
          { path: 'busqueda', component: VaciaPage },
          { path: 'metricas', component: VaciaPage },
          { path: 'perfil', component: VaciaPage },
          { path: 'login', component: VaciaPage },
        ]),
        { provide: AuthService, useValue: { autenticado } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PruebaPage);
    fixture.detectChanges();
  });

  const raiz = () => {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  // Al cargar, ion-button e ion-back-button le quitan del DOM los atributos
  // aria y los trasladan, en un momento y a un lugar que dependen del entorno.
  // DebugElement.attributes devuelve los atributos estáticos tal como los
  // declara la plantilla, sin importar lo que Ionic haga después.
  const query = (selector: string) => {
    fixture.detectChanges();
    return fixture.debugElement.queryAll(By.css(selector));
  };
  const nombre = (de: DebugElement) => de.attributes['aria-label'] ?? null;
  const botones = () => query('ion-toolbar ion-buttons[slot="end"] ion-button');
  const botonDe = (etiqueta: string) => botones().find((b) => nombre(b) === etiqueta) ?? null;
  const boton = (etiqueta: string) => (botonDe(etiqueta)?.nativeElement as HTMLElement | undefined) ?? null;
  const etiquetas = () => botones().map(nombre);
  // aria-current es un binding de RouterLinkActive; se comprueba su estado.
  const activo = (etiqueta: string) => botonDe(etiqueta)?.injector.get(RouterLinkActive).isActive;

  it('muestra el título', () => {
    expect(raiz().querySelector('ion-title')?.textContent?.trim()).toBe('Métricas');
  });

  it('sin sesión: buscar, métricas e "Ingresar", cada uno con aria-label', () => {
    expect(etiquetas()).toEqual(['Buscar productos', 'Ver métricas', 'Ingresar']);
    expect(boton('Ingresar')?.textContent?.trim()).toBe('Ingresar');
    expect(boton('Mi perfil')).toBeNull();
  });

  it('con sesión: buscar, métricas y "Mi perfil"', () => {
    autenticado.set(true);

    expect(etiquetas()).toEqual(['Buscar productos', 'Ver métricas', 'Mi perfil']);
    expect(boton('Ingresar')).toBeNull();
  });

  it('los íconos son decorativos: el nombre del botón está en aria-label', () => {
    autenticado.set(true);

    const iconos = raiz().querySelectorAll('ion-buttons[slot="end"] ion-icon');
    expect(iconos).toHaveLength(3);
    iconos.forEach((icono) => expect(icono.getAttribute('aria-hidden')).toBe('true'));
  });

  it.each([
    ['Buscar productos', '/busqueda'],
    ['Ver métricas', '/metricas'],
    ['Ingresar', '/login'],
  ])('"%s" navega a %s', async (etiqueta, ruta) => {
    boton(etiqueta)!.click();
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe(ruta);
  });

  it('"Mi perfil" navega a /perfil', async () => {
    autenticado.set(true);
    boton('Mi perfil')!.click();
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/perfil');
  });

  it('marca la acción de la página actual con aria-current', async () => {
    await TestBed.inject(Router).navigateByUrl('/metricas');
    await fixture.whenStable();

    expect(activo('Ver métricas')).toBe(true);
    expect(activo('Buscar productos')).toBe(false);
  });

  it('con atras muestra el botón volver, con aria-label y la ruta por defecto', () => {
    const [volver] = query('ion-buttons[slot="start"] ion-back-button');

    expect(volver && nombre(volver)).toBe('Volver');
    expect((volver?.nativeElement as { defaultHref?: string } | undefined)?.defaultHref).toBe('/home');
  });

  it('sin atras no hay botón volver', () => {
    fixture.componentInstance.atras.set(null);

    expect(raiz().querySelector('ion-back-button')).toBeNull();
  });

  it('agrega las acciones propias de la página antes de las compartidas', () => {
    fixture.componentInstance.conExtra.set(true);

    expect(etiquetas()).toEqual([
      'Actualizar métricas',
      'Buscar productos',
      'Ver métricas',
      'Ingresar',
    ]);
  });
});
