import { Injectable, inject } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
} from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { BusquedaProductos, RespuestaBusqueda } from './models/busqueda';
import {
  BusquedaPersonalizada,
  ModoBusqueda,
  RespuestaBusquedaPersonalizada,
} from './models/busqueda-personalizada';
import { Compatibilidad, DetalleCompatibilidad } from './models/compatibilidad';
import { ErrorApi, esErrorContrato } from './models/error';
import { DetalleProducto, Producto } from './models/producto';

/** Header del backend que indica si los datos vienen de FastAPI o del respaldo. */
const HEADER_FUENTE_DATOS = 'X-Fuente-Datos';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);
  private productsUrl = `${environment.apiUrl}/api/products`;

  /**
   * Busca productos por texto, ordenados por relevancia.
   * Si falla, el Observable emite un ErrorApi en vez de un HttpErrorResponse.
   */
  buscar(q: string, limit = 10, offset = 0): Observable<BusquedaProductos> {
    return this.buscarEn(`${this.productsUrl}/search`, q, limit, offset);
  }

  /**
   * Como buscar, pero solo entre los productos guardados sin alérgenos del
   * usuario. Requiere sesión (el interceptor agrega el token).
   */
  compatibles(q: string, limit = 10, offset = 0): Observable<BusquedaProductos> {
    return this.buscarEn(`${this.productsUrl}/compatibles`, q, limit, offset);
  }

  /**
   * Veredicto del motor adaptativo para el perfil del usuario, y si vino de
   * la revisión básica de respaldo. Requiere sesión.
   */
  compatibilidad(codigoBarras: string): Observable<DetalleCompatibilidad> {
    return this.http
      .get<Compatibilidad>(
        `${this.productsUrl}/${encodeURIComponent(codigoBarras)}/compatibilidad`,
        { observe: 'response' },
      )
      .pipe(
        map((respuesta) => ({
          compatibilidad: respuesta.body as Compatibilidad,
          desdeRespaldo: desdeRespaldo(respuesta.headers),
        })),
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }

  /**
   * Búsqueda personalizada según el perfil del usuario: filtrar oculta los
   * no aptos y reordenar los deja al final. Requiere sesión.
   */
  buscarPersonalizado(
    q: string,
    modo: ModoBusqueda,
    limit = 10,
    offset = 0,
  ): Observable<BusquedaPersonalizada> {
    const params = new HttpParams()
      .set('q', q)
      .set('modo', modo)
      .set('limit', limit)
      .set('offset', offset);

    return this.http
      .get<RespuestaBusquedaPersonalizada>(
        `${this.productsUrl}/search/personalizada`,
        { params, observe: 'response' },
      )
      .pipe(
        map((respuesta) => ({
          respuesta: respuesta.body as RespuestaBusquedaPersonalizada,
          desdeRespaldo: desdeRespaldo(respuesta.headers),
        })),
        catchError((error: HttpErrorResponse) =>
          throwError(() => aErrorApi(error)),
        ),
      );
  }

  private buscarEn(
    url: string,
    q: string,
    limit: number,
    offset: number,
  ): Observable<BusquedaProductos> {
    const params = new HttpParams()
      .set('q', q)
      .set('limit', limit)
      .set('offset', offset);

    return this.http
      .get<RespuestaBusqueda>(url, { params, observe: 'response' })
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
        `${this.productsUrl}/${encodeURIComponent(codigoBarras)}`,
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

function desdeRespaldo(headers: HttpHeaders): boolean {
  return headers.get(HEADER_FUENTE_DATOS) === 'respaldo';
}

/** Convierte un error HTTP en ErrorApi (mensaje del contrato o uno genérico). */
export function aErrorApi(error: HttpErrorResponse): ErrorApi {
  if (esErrorContrato(error.error)) {
    const { codigo, mensaje, request_id } = error.error.error;
    return { status: error.status, codigo, mensaje, requestId: request_id };
  }
  // Errores por defecto de NestJS (login, registro, validación): { message }.
  const message = (error.error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' || Array.isArray(message)) {
    const mensaje = Array.isArray(message) ? message.join('. ') : message;
    return { status: error.status, codigo: null, mensaje, requestId: null };
  }
  const mensaje =
    error.status === 0
      ? 'No se pudo conectar con el servidor.'
      : `Ocurrió un error inesperado (HTTP ${error.status}).`;
  return { status: error.status, codigo: null, mensaje, requestId: null };
}
