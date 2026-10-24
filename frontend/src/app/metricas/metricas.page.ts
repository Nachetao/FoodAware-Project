import { Component, DestroyRef, OnInit, WritableSignal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { MetricasService } from '../products/metricas.service';
import { ErrorApi } from '../products/models/error';
import {
  EstadoIngesta,
  MetricasCalidad,
  MetricasEvaluacion,
  ResumenIngesta,
} from '../products/models/metricas';
import * as formato from './formato';

/** Estado de cada tarjeta: se cargan por separado para que una falla no oculte las demás. */
export interface Seccion<T> {
  cargando: boolean;
  datos: T | null;
  error: ErrorApi | null;
}

const ETIQUETAS_ESTADO: Record<EstadoIngesta, { texto: string; color: string }> = {
  en_curso: { texto: 'En curso', color: 'medium' },
  completado: { texto: 'Completada', color: 'success' },
  completado_con_errores: { texto: 'Completada con errores', color: 'warning' },
  fallido: { texto: 'Fallida', color: 'danger' },
};

const vacia = <T>(): Seccion<T> => ({ cargando: true, datos: null, error: null });

@Component({
  selector: 'app-metricas',
  templateUrl: 'metricas.page.html',
  styleUrls: ['metricas.page.scss'],
  standalone: false,
})
export class MetricasPage implements OnInit {
  private metricasService = inject(MetricasService);
  private destroyRef = inject(DestroyRef);

  readonly calidad = signal<Seccion<MetricasCalidad>>(vacia());
  readonly evaluacion = signal<Seccion<MetricasEvaluacion>>(vacia());
  readonly ingesta = signal<Seccion<ResumenIngesta>>(vacia());

  readonly formato = formato;
  readonly etiquetaEstado = (estado: EstadoIngesta) => ETIQUETAS_ESTADO[estado];

  ngOnInit(): void {
    this.actualizar();
  }

  actualizar(): void {
    this.cargar(this.calidad, this.metricasService.calidad());
    this.cargar(this.evaluacion, this.metricasService.evaluacion());
    this.cargar(this.ingesta, this.metricasService.ultimaIngesta());
  }

  /** Mientras recarga conserva los datos anteriores, para que no parpadeen. */
  private cargar<T>(seccion: WritableSignal<Seccion<T>>, origen: Observable<T>): void {
    seccion.update((actual) => ({ ...actual, cargando: true, error: null }));
    origen.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (datos) => seccion.set({ cargando: false, datos, error: null }),
      error: (error: ErrorApi) => seccion.set({ cargando: false, datos: null, error }),
    });
  }
}
