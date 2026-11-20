import { Component, computed, input } from '@angular/core';
import { etiquetaAlergeno, separarAlergenos } from '../products/models/alergenos';

/**
 * Chips de alérgenos o trazas de un producto. Los que chocan con el perfil del
 * usuario van primero, en ámbar, con el ícono de advertencia y un texto para
 * lectores de pantalla (no dependen solo del color). Los demás van en neutro.
 * Sin perfil (sin sesión), todos son neutros.
 */
@Component({
  selector: 'app-chips-alergenos',
  template: `
    @if (prefijo(); as texto) {
      <span class="prefijo">{{ texto }}</span>
    }
    @for (codigo of separados().enConflicto; track codigo) {
      <ion-chip [class]="tipo() === 'traza' ? 'chip-traza' : 'chip-alergeno'">
        <ion-icon name="warning-outline" aria-hidden="true"></ion-icon>
        <span>{{ etiqueta(codigo) }}</span>
        <span class="solo-lectores"> (en tus alergias)</span>
      </ion-chip>
    }
    @for (codigo of separados().otros; track codigo) {
      <ion-chip [class]="tipo() === 'traza' ? 'chip-traza-neutro' : 'chip-alergeno-neutro'">
        <span>{{ etiqueta(codigo) }}</span>
      </ion-chip>
    }
  `,
  styles: `
    // Sin caja propia: el prefijo y los chips son ítems del contenedor flex de
    // la página, que define el espacio entre ellos.
    :host {
      display: contents;
    }

    .prefijo {
      align-self: center;
      font-size: 14px;
      font-weight: 600;
      color: var(--ion-text-color);
    }
  `,
  standalone: false,
})
export class ChipsAlergenosComponent {
  /** Códigos del producto (alergenos o trazas). */
  readonly codigos = input.required<readonly string[]>();
  /** Alergias del perfil del usuario; vacía sin sesión. */
  readonly alergiasUsuario = input<readonly string[]>([]);
  /** alergeno: borde continuo; traza ("Puede contener"): borde discontinuo. */
  readonly tipo = input<'alergeno' | 'traza'>('alergeno');
  /** Texto antes de los chips, por ejemplo "Contiene:". */
  readonly prefijo = input<string | null>(null);

  readonly separados = computed(() => separarAlergenos(this.codigos(), this.alergiasUsuario()));
  readonly etiqueta = etiquetaAlergeno;
}
