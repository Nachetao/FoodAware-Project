import { Component, inject } from '@angular/core';
import { ConexionService } from './conexion.service';

/** Texto del aviso: qué sigue funcionando sin conexión y qué no. */
export const TEXTO_SIN_CONEXION =
  'Puedes ver las páginas y los resultados que ya visitaste; para buscar algo nuevo, iniciar sesión o ver el veredicto para tu perfil necesitas internet.';

/**
 * Aviso global, debajo de la app, mientras no hay conexión. La región
 * role="status" existe siempre, así los lectores de pantalla anuncian el
 * cambio cuando aparece el texto.
 */
@Component({
  selector: 'app-aviso-sin-conexion',
  template: `
    <div class="aviso" role="status" [class.visible]="!conexion.enLinea()">
      @if (!conexion.enLinea()) {
        <ion-icon name="cloud-offline-outline" aria-hidden="true"></ion-icon>
        <p><strong>Sin conexión.</strong> {{ texto }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    // Blanco sobre verde bosque: 10.7:1.
    .aviso.visible {
      display: flex;
      gap: var(--app-espacio-2);
      align-items: flex-start;
      padding: var(--app-espacio-3) var(--app-espacio-4);
      padding-bottom: calc(var(--app-espacio-3) + var(--ion-safe-area-bottom, 0px));
      background: var(--ion-color-primary);
      color: var(--ion-color-primary-contrast);
      font-size: 14px;
      line-height: 1.4;
    }

    ion-icon {
      flex-shrink: 0;
      font-size: 20px;
    }

    p {
      margin: 0;
    }
  `,
  standalone: false,
})
export class AvisoSinConexionComponent {
  readonly conexion = inject(ConexionService);
  readonly texto = TEXTO_SIN_CONEXION;
}
