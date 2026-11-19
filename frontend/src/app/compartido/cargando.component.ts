import { Component, input } from '@angular/core';

/**
 * Estado de carga: el spinner es solo visual y el texto lo anuncia el lector
 * de pantalla (role="status"). Un aria-label en ion-spinner no basta: el
 * spinner no tiene rol y muchos lectores lo ignoran.
 */
@Component({
  selector: 'app-cargando',
  template: `
    <div class="cargando" role="status">
      <ion-spinner name="crescent" aria-hidden="true"></ion-spinner>
      <span class="solo-lectores">{{ texto() }}</span>
    </div>
  `,
  styles: `
    .cargando {
      display: flex;
      justify-content: center;
      padding: var(--app-espacio-6) 0;
    }
  `,
  standalone: false,
})
export class CargandoComponent {
  /** Qué se está cargando, por ejemplo "Buscando productos…". */
  readonly texto = input.required<string>();
}
