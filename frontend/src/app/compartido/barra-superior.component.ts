import { Component, inject, input } from '@angular/core';
import { AuthService } from '../auth/auth.service';

/**
 * Barra superior de todas las páginas: título, botón atrás opcional y las
 * mismas acciones siempre visibles (buscar, métricas y perfil o ingresar; y
 * administración, solo para administradores).
 * Va dentro del <ion-header> de cada página, así una página puede agregar
 * otra barra debajo (por ejemplo, el buscador). Las acciones propias de una
 * página se proyectan con el atributo accionExtra:
 *
 *   <ion-header>
 *     <app-barra-superior titulo="Métricas" atras="/home">
 *       <ion-button accionExtra aria-label="Actualizar">…</ion-button>
 *     </app-barra-superior>
 *   </ion-header>
 */
@Component({
  selector: 'app-barra-superior',
  template: `
    <ion-toolbar>
      @if (atras(); as ruta) {
        <ion-buttons slot="start">
          <ion-back-button [defaultHref]="ruta" text="" aria-label="Volver"></ion-back-button>
        </ion-buttons>
      }
      <ion-title>{{ titulo() }}</ion-title>
      <ion-buttons slot="end">
        <ng-content select="[accionExtra]"></ng-content>
        <ion-button
          routerLink="/busqueda"
          routerLinkActive
          #buscar="routerLinkActive"
          [attr.aria-current]="buscar.isActive ? 'page' : null"
          aria-label="Buscar productos"
        >
          <ion-icon slot="icon-only" name="search-outline" aria-hidden="true"></ion-icon>
        </ion-button>
        <ion-button
          routerLink="/metricas"
          routerLinkActive
          #metricas="routerLinkActive"
          [attr.aria-current]="metricas.isActive ? 'page' : null"
          aria-label="Ver métricas"
        >
          <ion-icon slot="icon-only" name="stats-chart-outline" aria-hidden="true"></ion-icon>
        </ion-button>
        @if (auth.esAdmin()) {
          <ion-button
            routerLink="/admin"
            routerLinkActive
            #admin="routerLinkActive"
            [attr.aria-current]="admin.isActive ? 'page' : null"
            aria-label="Administración"
          >
            <ion-icon slot="icon-only" name="shield-checkmark-outline" aria-hidden="true"></ion-icon>
          </ion-button>
        }
        @if (auth.autenticado()) {
          <ion-button
            routerLink="/perfil"
            routerLinkActive
            #perfil="routerLinkActive"
            [attr.aria-current]="perfil.isActive ? 'page' : null"
            aria-label="Mi perfil"
          >
            <ion-icon slot="icon-only" name="person-circle-outline" aria-hidden="true"></ion-icon>
          </ion-button>
        } @else {
          <ion-button
            class="ingresar"
            routerLink="/login"
            routerLinkActive
            #login="routerLinkActive"
            [attr.aria-current]="login.isActive ? 'page' : null"
            aria-label="Ingresar"
          >Ingresar</ion-button>
        }
      </ion-buttons>
    </ion-toolbar>
  `,
  styles: `
    :host {
      display: block;
    }

    .ingresar {
      font-weight: 600;
    }

    // Pantallas estrechas: título a 16 px y con menos relleno. El ancho de los
    // botones está en global.scss, porque también aplica a los botones que
    // proyecta cada página (accionExtra).
    @media (max-width: 480px) {
      ion-title {
        padding-inline: var(--app-espacio-1);
        font-size: 16px;
      }
    }
  `,
  standalone: false,
})
export class BarraSuperiorComponent {
  readonly auth = inject(AuthService);

  /** Título de la página. */
  readonly titulo = input.required<string>();
  /** Ruta a la que vuelve el botón atrás si no hay historial; sin ella, no hay botón. */
  readonly atras = input<string | null>(null);
}
