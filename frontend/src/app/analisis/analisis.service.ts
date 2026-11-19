import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { aErrorApi } from '../products/products.service';

/** Producto analizado y guardado por el backend en /api/food/analizar. */
export interface ResultadoAnalisis {
  id: string;
  nombre: string;
  ingredientes: string[];
  /** Alérgenos que detectó el análisis, tal como los devuelve (p. ej. "maní"). */
  alergenosPresentes: string[] | null;
  esNutricionalmenteSaludable: boolean;
  /**
   * Sin sesión: no se detectó ningún alérgeno. Con sesión: ninguno choca
   * con las alergias del usuario.
   */
  aptoParaConsumo: boolean;
}

/** Cuerpo de la respuesta de POST /api/food/analizar. */
export interface RespuestaAnalisis {
  message: string;
  resultado: ResultadoAnalisis;
}

/** Análisis manual de un producto a partir de sus ingredientes. */
@Injectable({ providedIn: 'root' })
export class AnalisisService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/api/food/analizar`;

  /** Si falla, el Observable emite un ErrorApi en vez de un HttpErrorResponse. */
  analizar(
    nombre: string,
    ingredientes: string[],
  ): Observable<ResultadoAnalisis> {
    return this.http
      .post<RespuestaAnalisis>(this.url, { nombre, ingredientes })
      .pipe(
        map((respuesta) => respuesta.resultado),
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }
}
