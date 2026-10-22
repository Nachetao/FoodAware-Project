import { Injectable, inject } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { RespuestaBusqueda } from './models/busqueda';
import { ErrorApi, esErrorContrato } from './models/error';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);
  private searchUrl = `${environment.apiUrl}/api/products/search`;

  /**
   * Busca productos por texto, ordenados por relevancia.
   * Si falla, el Observable emite un ErrorApi en vez de un HttpErrorResponse.
   */
  buscar(q: string, limit = 10, offset = 0): Observable<RespuestaBusqueda> {
    const params = new HttpParams()
      .set('q', q)
      .set('limit', limit)
      .set('offset', offset);

    return this.http
      .get<RespuestaBusqueda>(this.searchUrl, { params })
      .pipe(
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }
}

function aErrorApi(error: HttpErrorResponse): ErrorApi {
  if (esErrorContrato(error.error)) {
    const { codigo, mensaje, request_id } = error.error.error;
    return { status: error.status, codigo, mensaje, requestId: request_id };
  }
  const mensaje =
    error.status === 0
      ? 'No se pudo conectar con el servidor.'
      : `Ocurrió un error inesperado (HTTP ${error.status}).`;
  return { status: error.status, codigo: null, mensaje, requestId: null };
}
