import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/** Evento beforeinstallprompt (Chrome, Edge y Android; no existe en Safari). */
export interface EventoInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Ofrece instalar la PWA cuando el navegador lo permite. No se ofrece en la
 * app de Android ni si ya se abrió instalada. Se crea al iniciar la app
 * (AppComponent), porque el navegador avisa una sola vez y muy pronto.
 */
@Injectable({ providedIn: 'root' })
export class InstalacionService {
  private evento: EventoInstalacion | null = null;
  private readonly estado = signal(false);
  /** true si hay que mostrar "Instalar FoodAware". */
  readonly disponible = this.estado.asReadonly();

  constructor() {
    if (Capacitor.isNativePlatform() || window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }
    const alOfrecer = (evento: Event) => {
      // Sin la mini barra del navegador: la app muestra su propio botón.
      evento.preventDefault();
      this.evento = evento as EventoInstalacion;
      this.estado.set(true);
    };
    const alInstalar = () => this.olvidar();
    window.addEventListener('beforeinstallprompt', alOfrecer);
    window.addEventListener('appinstalled', alInstalar);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', alOfrecer);
      window.removeEventListener('appinstalled', alInstalar);
    });
  }

  /** Muestra el diálogo del navegador; true si el usuario aceptó instalar. */
  async instalar(): Promise<boolean> {
    const evento = this.evento;
    if (!evento) {
      return false;
    }
    // El evento sirve una sola vez: si lo rechaza, el navegador volverá a ofrecerlo.
    this.olvidar();
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    return outcome === 'accepted';
  }

  private olvidar(): void {
    this.evento = null;
    this.estado.set(false);
  }
}
