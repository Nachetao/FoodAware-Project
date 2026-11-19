import { Component, input, output } from '@angular/core';
import { ETIQUETAS_ALERGENOS } from '../products/models/alergenos';
import { AllergenCode } from '../products/models/enums';

/** Chips seleccionables con los 14 alérgenos del contrato. */
@Component({
  selector: 'app-selector-alergias',
  template: `
    <div class="chips" role="group" aria-label="Alergias">
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
          <ion-chip [class.chip-alergeno]="elegida" [outline]="!elegida">
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
export class SelectorAlergiasComponent {
  readonly seleccion = input<AllergenCode[]>([]);
  readonly cambio = output<AllergenCode[]>();

  readonly opciones = (Object.entries(ETIQUETAS_ALERGENOS) as [AllergenCode, string][]).map(
    ([codigo, etiqueta]) => ({ codigo, etiqueta }),
  );

  alternar(codigo: AllergenCode): void {
    const actual = this.seleccion();
    this.cambio.emit(
      actual.includes(codigo) ? actual.filter((c) => c !== codigo) : [...actual, codigo],
    );
  }
}
