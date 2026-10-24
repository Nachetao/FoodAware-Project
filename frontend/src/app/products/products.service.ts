import { Injectable, inject } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { BusquedaProductos, RespuestaBusqueda } from './models/busqueda';
import { ErrorApi, esErrorContrato } from './models/error';
import { DetalleProducto, Producto } from './models/producto';

/** Header del backend que indica si los datos vienen de FastAPI o del respaldo. */
const HEADER_FUENTE_DATOS = 'X-Fuente-Datos';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);
  private searchUrl = `${environment.apiUrl}/api/products/search`;

  /**
   * Busca productos por texto, ordenados por relevancia.
   * Si falla, el Observable emite un ErrorApi en vez de un HttpErrorResponse.
   */
  buscar(q: string, limit = 10, offset = 0): Observable<BusquedaProductos> {
    const params = new HttpParams()
      .set('q', q)
      .set('limit', limit)
      .set('offset', offset);

    return this.http
      .get<RespuestaBusqueda>(this.searchUrl, { params, observe: 'response' })
      .pipe(
        map((respuesta) => ({
          respuesta: respuesta.body as RespuestaBusqueda,
          desdeRespaldo:
            respuesta.headers.get(HEADER_FUENTE_DATOS) === 'respaldo',
        })),
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }

  /**
   * Detalle de un producto. Un producto inexistente llega como ErrorApi con
   * codigo NOT_FOUND (404).
   */
  obtener(codigoBarras: string): Observable<DetalleProducto> {
    return this.http
      .get<Producto>(
        `${environment.apiUrl}/api/products/${encodeURIComponent(codigoBarras)}`,
        { observe: 'response' },
      )
      .pipe(
        map((respuesta) => ({
          producto: respuesta.body as Producto,
          desdeRespaldo:
            respuesta.headers.get(HEADER_FUENTE_DATOS) === 'respaldo',
        })),
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }
}

/** Convierte un error HTTP en ErrorApi (mensaje del contrato o uno genérico). */
export function aErrorApi(error: HttpErrorResponse): ErrorApi {
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
