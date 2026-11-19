import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Si el dispositivo tiene conexión, según el navegador (eventos online/offline). */
@Injectable({ providedIn: 'root' })
export class ConexionService {
  private readonly estado = signal(navigator.onLine);
  readonly enLinea = this.estado.asReadonly();

  constructor() {
    const actualizar = () => this.estado.set(navigator.onLine);
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', actualizar);
      window.removeEventListener('offline', actualizar);
    });
  }
}
