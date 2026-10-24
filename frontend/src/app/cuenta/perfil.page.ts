import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AllergenCode } from '../products/models/enums';
import { ErrorApi } from '../products/models/error';

@Component({
  selector: 'app-perfil',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/home" text=""></ion-back-button></ion-buttons>
        <ion-title>Mi perfil</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="formulario">
        @if (auth.usuario(); as u) {
          <h1 class="nombre">{{ u.nombre }}</h1>
          <p class="correo">{{ u.correo }}</p>

          <h2>Mis alergias</h2>
          <app-selector-alergias [seleccion]="alergias()" (cambio)="alergias.set($event)"></app-selector-alergias>
          @if (mensaje()) {
            <p class="ayuda" role="status">{{ mensaje() }}</p>
          }
          @if (error()) {
            <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text>
          }
          <ion-button class="guardar" expand="block" color="secondary"
            [disabled]="guardando() || !hayCambios()" (click)="guardar()">
            {{ guardando() ? 'Guardando…' : 'Guardar alergias' }}
          </ion-button>
        } @else {
          <div class="estado"><ion-spinner name="crescent" aria-label="Cargando perfil"></ion-spinner></div>
        }
        <ion-button class="salir" expand="block" fill="outline" (click)="cerrarSesion()">
          Cerrar sesión
        </ion-button>
      </div>
    </ion-content>
  `,
  styleUrls: ['cuenta.scss'],
  standalone: false,
})
export class PerfilPage implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  // Copia editable; se guarda solo al tocar "Guardar alergias".
  readonly alergias = signal<AllergenCode[]>([]);
  readonly guardando = signal(false);
  readonly mensaje = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly hayCambios = computed(() => {
    const guardadas = this.auth.usuario()?.alergias ?? [];
    const editadas = this.alergias();
    return guardadas.length !== editadas.length || editadas.some((a) => !guardadas.includes(a));
  });

  ngOnInit(): void {
    const usuario = this.auth.usuario();
    if (usuario) {
      this.alergias.set(usuario.alergias);
    } else {
      this.auth.cargarPerfil().subscribe({
        next: (u) => this.alergias.set(u.alergias),
        error: (error: ErrorApi) => this.error.set(error.mensaje),
      });
    }
  }

  guardar(): void {
    this.guardando.set(true);
    this.mensaje.set(null);
    this.error.set(null);
    this.auth.actualizarAlergias(this.alergias()).subscribe({
      next: (u) => {
        this.alergias.set(u.alergias);
        this.guardando.set(false);
        this.mensaje.set('Alergias guardadas.');
      },
      error: (error: ErrorApi) => {
        this.guardando.set(false);
        this.error.set(error.mensaje);
      },
    });
  }

  cerrarSesion(): void {
    this.auth.cerrarSesion();
    void this.router.navigateByUrl('/home');
  }
}
