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
        <ion-chip
          [class.chip-alergeno]="elegida"
          [outline]="!elegida"
          role="button"
          [attr.aria-pressed]="elegida"
          [attr.data-codigo]="opcion.codigo"
          (click)="alternar(opcion.codigo)"
        >
          @if (elegida) {
            <ion-icon name="checkmark-outline" aria-hidden="true"></ion-icon>
          }
          <span>{{ opcion.etiqueta }}</span>
        </ion-chip>
      }
    </div>
  `,
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--app-espacio-2);
    }
    ion-chip {
      margin: 0;
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
