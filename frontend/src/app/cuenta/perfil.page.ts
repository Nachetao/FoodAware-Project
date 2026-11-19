import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/lazy';
import { AuthService, Usuario } from '../auth/auth.service';
import { AllergenCode, DietLabel } from '../products/models/enums';
import { ErrorApi } from '../products/models/error';

/** Frase del interruptor de modo estricto (la misma regla del motor). */
export const AYUDA_MODO_ESTRICTO =
  'Con el modo estricto, las trazas, los posibles alérgenos y los productos con pocos datos se marcan como no aptos en vez de con advertencia.';

const mismos = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

@Component({
  selector: 'app-perfil',
  template: `
    <ion-header>
      <app-barra-superior titulo="Mi perfil" atras="/home"></app-barra-superior>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="formulario">
        @if (auth.usuario(); as u) {
          <h1 class="nombre">{{ u.nombre }}</h1>
          <p class="correo">{{ u.correo }}</p>

          <ion-input class="campo-nombre" label="Nombre" labelPlacement="stacked" fill="outline"
            autocomplete="name" maxlength="100" [value]="nombre()"
            (ionInput)="nombre.set($event.detail.value ?? '')"></ion-input>
          @if (!nombre().trim()) {
            <p class="ayuda" role="status">El nombre no puede quedar vacío.</p>
          }

          <h2>Mis alergias</h2>
          <app-selector-alergias [seleccion]="alergias()" (cambio)="alergias.set($event)"></app-selector-alergias>

          <h2>Mis dietas</h2>
          <p class="ayuda">Los productos que no declaren cumplirlas se marcan con advertencia.</p>
          <app-selector-dietas [seleccion]="dietas()" (cambio)="dietas.set($event)"></app-selector-dietas>

          <ion-toggle class="modo-estricto" justify="space-between" [checked]="modoEstricto()"
            (ionChange)="modoEstricto.set($event.detail.checked)">Modo estricto</ion-toggle>
          <p class="ayuda ayuda-estricto">{{ ayudaModoEstricto }}</p>

          @if (mensaje()) {
            <p class="ayuda" role="status">{{ mensaje() }}</p>
          }
          @if (error()) {
            <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text>
          }
          <ion-button class="guardar" expand="block" color="secondary"
            [disabled]="guardando() || !hayCambios() || !nombre().trim()" (click)="guardar()">
            {{ guardando() ? 'Guardando…' : 'Guardar cambios' }}
          </ion-button>
        } @else {
          <app-cargando texto="Cargando perfil…"></app-cargando>
          @if (error()) {
            <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text>
          }
        }
        <ion-button class="salir" expand="block" fill="outline" (click)="cerrarSesion()">
          Cerrar sesión
        </ion-button>
        @if (auth.usuario()) {
          <ion-button class="borrar" expand="block" fill="clear" color="danger"
            [disabled]="borrando()" (click)="confirmarBorrado()">
            {{ borrando() ? 'Borrando cuenta…' : 'Borrar mi cuenta' }}
          </ion-button>
        }
      </div>
    </ion-content>
  `,
  styleUrls: ['cuenta.scss'],
  standalone: false,
})
export class PerfilPage implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private alertCtrl = inject(AlertController);

  readonly ayudaModoEstricto = AYUDA_MODO_ESTRICTO;

  // Copia editable; se guarda solo al tocar "Guardar cambios".
  readonly nombre = signal('');
  readonly alergias = signal<AllergenCode[]>([]);
  readonly dietas = signal<DietLabel[]>([]);
  readonly modoEstricto = signal(false);

  readonly guardando = signal(false);
  readonly borrando = signal(false);
  readonly mensaje = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly hayCambios = computed(() => {
    const u = this.auth.usuario();
    return (
      !!u &&
      (this.nombre().trim() !== u.nombre ||
        !mismos(this.alergias(), u.alergias) ||
        !mismos(this.dietas(), u.dietas) ||
        this.modoEstricto() !== u.modo_estricto)
    );
  });

  ngOnInit(): void {
    const usuario = this.auth.usuario();
    if (usuario) {
      this.copiar(usuario);
    } else {
      this.auth.cargarPerfil().subscribe({
        next: (u) => this.copiar(u),
        error: (error: ErrorApi) => this.error.set(error.mensaje),
      });
    }
  }

  guardar(): void {
    this.guardando.set(true);
    this.mensaje.set(null);
    this.error.set(null);
    this.auth
      .actualizarPerfil({
        nombre: this.nombre().trim(),
        alergias: this.alergias(),
        dietas: this.dietas(),
        modo_estricto: this.modoEstricto(),
      })
      .subscribe({
        next: (u) => {
          this.copiar(u);
          this.guardando.set(false);
          this.mensaje.set('Cambios guardados.');
        },
        error: (error: ErrorApi) => {
          this.guardando.set(false);
          this.error.set(error.mensaje);
        },
      });
  }

  /** Pide confirmación antes de borrar: no se puede deshacer. */
  async confirmarBorrado(): Promise<void> {
    const alerta = await this.alertCtrl.create({
      header: '¿Borrar tu cuenta?',
      message:
        'Se borrarán tu nombre, tu correo, tu contraseña, tus alergias y tus dietas. Esta acción no se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Borrar cuenta', role: 'destructive', handler: () => this.borrarCuenta() },
      ],
    });
    await alerta.present();
  }

  cerrarSesion(): void {
    this.auth.cerrarSesion();
    void this.router.navigateByUrl('/home');
  }

  private borrarCuenta(): void {
    this.borrando.set(true);
    this.mensaje.set(null);
    this.error.set(null);
    this.auth.borrarCuenta().subscribe({
      // AuthService ya cerró la sesión.
      next: () => void this.router.navigateByUrl('/home'),
      error: (error: ErrorApi) => {
        this.borrando.set(false);
        this.error.set(error.mensaje);
      },
    });
  }

  private copiar(usuario: Usuario): void {
    this.nombre.set(usuario.nombre);
    this.alergias.set(usuario.alergias);
    this.dietas.set(usuario.dietas);
    this.modoEstricto.set(usuario.modo_estricto);
  }
}
