import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { Rol } from '../auth/auth.service';
import { aErrorApi } from '../products/products.service';

/** Usuario en la lista de administración: sin contraseña ni datos de salud. */
export interface UsuarioResumen {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
}

/** Alimento guardado por el análisis manual (GET /api/food). */
export interface AlimentoAnalizado {
  id: string;
  nombre: string;
  ingredientes: string[];
  alergenosPresentes: string[] | null;
  esNutricionalmenteSaludable: boolean;
}

/** Endpoints solo para administradores. Los errores llegan como ErrorApi. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/api`;

  usuarios(): Observable<UsuarioResumen[]> {
    return this.get<UsuarioResumen[]>('/usuarios');
  }

  alimentos(): Observable<AlimentoAnalizado[]> {
    return this.get<AlimentoAnalizado[]>('/food');
  }

  private get<T>(ruta: string): Observable<T> {
    return this.http
      .get<T>(`${this.api}${ruta}`)
      .pipe(catchError((error: HttpErrorResponse) => throwError(() => aErrorApi(error))));
  }
}
