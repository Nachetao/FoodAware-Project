import { Component, DestroyRef, OnInit, WritableSignal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { ErrorApi } from '../products/models/error';
import { AdminService, AlimentoAnalizado, UsuarioResumen } from './admin.service';

/** Estado de una sección: se cargan por separado para que una falla no oculte la otra. */
export interface Seccion<T> {
  cargando: boolean;
  datos: T[] | null;
  error: string | null;
}

const vacia = <T>(): Seccion<T> => ({ cargando: true, datos: null, error: null });

/** Administración (solo lectura): usuarios y alimentos analizados. */
@Component({
  selector: 'app-admin',
  templateUrl: 'admin.page.html',
  styleUrls: ['admin.page.scss'],
  standalone: false,
})
export class AdminPage implements OnInit {
  private adminService = inject(AdminService);
  private destroyRef = inject(DestroyRef);

  readonly usuarios = signal<Seccion<UsuarioResumen>>(vacia());
  readonly alimentos = signal<Seccion<AlimentoAnalizado>>(vacia());

  ngOnInit(): void {
    this.actualizar();
  }

  actualizar(): void {
    this.cargar(this.usuarios, this.adminService.usuarios());
    this.cargar(this.alimentos, this.adminService.alimentos());
  }

  /** "maní, lácteos" o null si no se detectó ninguno. */
  alergenos(alimento: AlimentoAnalizado): string | null {
    return alimento.alergenosPresentes?.length ? alimento.alergenosPresentes.join(', ') : null;
  }

  /** Mientras recarga conserva los datos anteriores, para que no parpadeen. */
  private cargar<T>(seccion: WritableSignal<Seccion<T>>, origen: Observable<T[]>): void {
    seccion.update((actual) => ({ ...actual, cargando: true, error: null }));
    origen.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (datos) => seccion.set({ cargando: false, datos, error: null }),
      error: (error: ErrorApi) =>
        seccion.update((actual) => ({ ...actual, cargando: false, error: error.mensaje })),
    });
  }
}
