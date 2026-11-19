import { Component, input, output } from '@angular/core';
import { ETIQUETAS_DIETA } from '../products/models/alergenos';
import { DietLabel } from '../products/models/enums';

/** Chips seleccionables con las dietas del contrato (como el selector de alergias). */
@Component({
  selector: 'app-selector-dietas',
  template: `
    <div class="chips" role="group" aria-label="Dietas">
      @for (opcion of opciones; track opcion.codigo) {
        @let elegida = seleccion().includes(opcion.codigo);
        <!-- Botón nativo (foco, Enter y Espacio, 44 px) con el chip de siempre adentro. -->
        <button
          type="button"
          class="opcion-chip"
          [attr.aria-pressed]="elegida"
          [attr.data-codigo]="opcion.codigo"
          (click)="alternar(opcion.codigo)"
        >
          <ion-chip [class.chip-dieta]="elegida" [outline]="!elegida">
            @if (elegida) {
              <ion-icon name="checkmark-outline" aria-hidden="true"></ion-icon>
            }
            <span>{{ opcion.etiqueta }}</span>
          </ion-chip>
        </button>
      }
    </div>
  `,
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      column-gap: var(--app-espacio-2);
    }
  `,
  standalone: false,
})
export class SelectorDietasComponent {
  readonly seleccion = input<DietLabel[]>([]);
  readonly cambio = output<DietLabel[]>();

  readonly opciones = (Object.entries(ETIQUETAS_DIETA) as [DietLabel, string][]).map(
    ([codigo, etiqueta]) => ({ codigo, etiqueta }),
  );

  alternar(codigo: DietLabel): void {
    const actual = this.seleccion();
    this.cambio.emit(
      actual.includes(codigo) ? actual.filter((c) => c !== codigo) : [...actual, codigo],
    );
  }
}
