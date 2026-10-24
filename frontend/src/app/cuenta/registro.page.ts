import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AllergenCode } from '../products/models/enums';
import { ErrorApi } from '../products/models/error';

@Component({
  selector: 'app-registro',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/login" text=""></ion-back-button></ion-buttons>
        <ion-title>Crear cuenta</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <form class="formulario" (ngSubmit)="registrar()">
        <ion-input name="nombre" label="Nombre" labelPlacement="floating"
          autocomplete="name" [(ngModel)]="nombre" required></ion-input>
        <ion-input name="correo" type="email" label="Correo" labelPlacement="floating"
          autocomplete="email" [(ngModel)]="correo" required></ion-input>
        <ion-input name="password" type="password" label="Contraseña" labelPlacement="floating"
          autocomplete="new-password" [(ngModel)]="password" required></ion-input>
        <h2>¿A qué eres alérgico?</h2>
        <p class="ayuda">Toca los que correspondan. Puedes cambiarlos después en tu perfil.</p>
        <app-selector-alergias [seleccion]="alergias()" (cambio)="alergias.set($event)"></app-selector-alergias>
        @if (error()) {
          <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text>
        }
        <ion-button type="submit" expand="block" color="secondary"
          [disabled]="enviando() || !nombre.trim() || !correo.trim() || !password">
          {{ enviando() ? 'Creando cuenta…' : 'Crear cuenta' }}
        </ion-button>
        <p class="alternativa">¿Ya tienes cuenta? <a routerLink="/login">Ingresa</a></p>
      </form>
    </ion-content>
  `,
  styleUrls: ['cuenta.scss'],
  standalone: false,
})
export class RegistroPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  nombre = '';
  correo = '';
  password = '';
  readonly alergias = signal<AllergenCode[]>([]);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  registrar(): void {
    this.enviando.set(true);
    this.error.set(null);
    this.auth
      .registrar({
        nombre: this.nombre.trim(),
        correo: this.correo.trim(),
        password: this.password,
        alergias: this.alergias(),
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          void this.router.navigateByUrl('/home');
        },
        error: (error: ErrorApi) => {
          this.enviando.set(false);
          this.error.set(error.mensaje);
        },
      });
  }
}
