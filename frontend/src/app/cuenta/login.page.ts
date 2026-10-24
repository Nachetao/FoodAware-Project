import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ErrorApi } from '../products/models/error';

@Component({
  selector: 'app-login',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/home" text=""></ion-back-button></ion-buttons>
        <ion-title>Ingresar</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <form class="formulario" (ngSubmit)="ingresar()">
        <ion-input name="correo" type="email" label="Correo" labelPlacement="floating"
          autocomplete="email" [(ngModel)]="correo" required></ion-input>
        <ion-input name="password" type="password" label="Contraseña" labelPlacement="floating"
          autocomplete="current-password" [(ngModel)]="password" required></ion-input>
        @if (error()) {
          <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text>
        }
        <ion-button type="submit" expand="block" color="secondary"
          [disabled]="enviando() || !correo.trim() || !password">
          {{ enviando() ? 'Ingresando…' : 'Ingresar' }}
        </ion-button>
        <p class="alternativa">¿No tienes cuenta? <a routerLink="/registro">Regístrate</a></p>
      </form>
    </ion-content>
  `,
  styleUrls: ['cuenta.scss'],
  standalone: false,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);

  correo = '';
  password = '';
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  ingresar(): void {
    this.enviando.set(true);
    this.error.set(null);
    this.auth.login(this.correo.trim(), this.password).subscribe({
      next: () => {
        this.enviando.set(false);
        const volver = this.ruta.snapshot.queryParamMap.get('volver');
        // Solo rutas internas: evita redirigir a otro sitio.
        void this.router.navigateByUrl(volver?.startsWith('/') ? volver : '/home');
      },
      error: (error: ErrorApi) => {
        this.enviando.set(false);
        this.error.set(error.mensaje);
      },
    });
  }
}
