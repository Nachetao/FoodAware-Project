import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  MetricasCalidad,
  MetricasEvaluacion,
  ResumenIngesta,
} from './models/metricas';
import { aErrorApi } from './products.service';

/** Métricas de calidad, evaluación e ingesta. Los errores llegan como ErrorApi. */
@Injectable({ providedIn: 'root' })
export class MetricasService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/api`;

  calidad(): Observable<MetricasCalidad> {
    return this.get<MetricasCalidad>('/metricas/calidad');
  }

  evaluacion(): Observable<MetricasEvaluacion> {
    return this.get<MetricasEvaluacion>('/metricas/evaluacion');
  }

  /** Error con codigo NOT_FOUND (404) si todavía no hay ninguna ingesta. */
  ultimaIngesta(): Observable<ResumenIngesta> {
    return this.get<ResumenIngesta>('/ingesta/ultima');
  }

  private get<T>(ruta: string): Observable<T> {
    return this.http
      .get<T>(`${this.api}${ruta}`)
      .pipe(
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }
}
