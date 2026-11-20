import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AllergenCode } from '../products/models/enums';
import { ErrorApi } from '../products/models/error';

/** Largo mínimo de la contraseña al crear la cuenta. */
export const MINIMO_PASSWORD = 8;

@Component({
  selector: 'app-registro',
  template: `
    <ion-header>
      <app-barra-superior titulo="Crear cuenta" atras="/login"></app-barra-superior>
    </ion-header>
    <ion-content class="ion-padding">
      <form class="formulario" (ngSubmit)="registrar()">
        <h1 class="solo-lectores">Crear cuenta</h1>
        <ion-input name="nombre" label="Nombre" labelPlacement="floating"
          autocomplete="name" [(ngModel)]="nombre" required></ion-input>
        <ion-input name="correo" type="email" label="Correo" labelPlacement="floating"
          autocomplete="email" [(ngModel)]="correo" required></ion-input>
        <ion-input name="password" type="password" label="Contraseña" labelPlacement="floating"
          autocomplete="new-password" [(ngModel)]="password" required
          [attr.minlength]="minimoPassword" aria-describedby="ayuda-password"></ion-input>
        <p id="ayuda-password" class="ayuda">Mínimo {{ minimoPassword }} caracteres.</p>
        <h2>¿A qué eres alérgico?</h2>
        <p class="ayuda">Toca los que correspondan. Puedes cambiarlos después en tu perfil.</p>
        <app-selector-alergias [seleccion]="alergias()" (cambio)="alergias.set($event)"></app-selector-alergias>
        @if (error()) {
          <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text>
        }
        <ion-button type="submit" expand="block" color="secondary"
          [disabled]="enviando() || !nombre.trim() || !correo.trim() || !passwordValida()">
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

  /** Igual que el DTO del backend (solo al registrarse; el login no lo exige). */
  readonly minimoPassword = MINIMO_PASSWORD;

  nombre = '';
  correo = '';
  password = '';
  readonly alergias = signal<AllergenCode[]>([]);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  passwordValida(): boolean {
    return this.password.length >= MINIMO_PASSWORD;
  }

  registrar(): void {
    // Enter en el formulario envía aunque el botón esté deshabilitado.
    if (!this.passwordValida()) {
      this.error.set(`La contraseña debe tener al menos ${MINIMO_PASSWORD} caracteres.`);
      return;
    }
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
