import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input } from '@angular/core';

/** Clase del botón "limpiar" que Ionic dibuja dentro de ion-searchbar. */
export const SELECTOR_BOTON_LIMPIAR = '.searchbar-clear-button';

/**
 * Pone en español el nombre accesible del botón "limpiar" (la x) de
 * ion-searchbar: Ionic le asigna aria-label="reset" fijo y no ofrece una
 * propiedad para cambiarlo.
 *
 * Usa un MutationObserver: si Ionic vuelve a dibujar el buscador (al hidratar
 * o al cambiar de modo) y crea el botón de nuevo o le devuelve "reset", la
 * etiqueta se corrige otra vez. Depende de la clase interna
 * .searchbar-clear-button: si una versión de Ionic la cambiara, no rompe nada,
 * solo volvería a quedar "reset" (lo detecta su test).
 *
 *   <ion-searchbar appEtiquetaLimpiar="Limpiar búsqueda"></ion-searchbar>
 */
@Directive({
  selector: 'ion-searchbar[appEtiquetaLimpiar]',
  standalone: false,
})
export class EtiquetaLimpiarDirective implements AfterViewInit, OnDestroy {
  readonly appEtiquetaLimpiar = input('Limpiar búsqueda');

  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private observador?: MutationObserver;

  ngAfterViewInit(): void {
    this.aplicar();
    this.observador = new MutationObserver(() => this.aplicar());
    this.observador.observe(this.elemento.nativeElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
  }

  private aplicar(): void {
    const etiqueta = this.appEtiquetaLimpiar() || 'Limpiar búsqueda';
    const boton = this.elemento.nativeElement.querySelector(SELECTOR_BOTON_LIMPIAR);
    // Solo si cambia: escribir el mismo valor dispararía el observador de nuevo.
    if (boton && boton.getAttribute('aria-label') !== etiqueta) {
      boton.setAttribute('aria-label', etiqueta);
    }
  }
}
