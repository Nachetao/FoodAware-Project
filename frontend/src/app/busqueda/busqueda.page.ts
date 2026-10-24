import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Subject,
  catchError,
  defer,
  distinctUntilChanged,
  finalize,
  switchMap,
  tap,
} from 'rxjs';
import { ProductsService } from '../products/products.service';
import { etiquetaAlergeno } from '../products/models/alergenos';
import { ResultadoBusqueda } from '../products/models/busqueda';
import { ErrorApi } from '../products/models/error';

const TAMANO_PAGINA = 20;
const MIN_CARACTERES = 2;
// En Render (plan gratuito) el backend se duerme y la primera respuesta tarda.
const ESPERA_DESPERTAR_MS = 5000;

@Component({
  selector: 'app-busqueda',
  templateUrl: 'busqueda.page.html',
  styleUrls: ['busqueda.page.scss'],
  standalone: false,
})
export class BusquedaPage {
  private productsService = inject(ProductsService);
  private destroyRef = inject(DestroyRef);

  // Signals: sin zone.js, actualizan la vista sin llamar a detectChanges().
  readonly consulta = signal('');
  readonly resultados = signal<ResultadoBusqueda[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly cargandoMas = signal(false);
  readonly buscado = signal(false);
  readonly error = signal<string | null>(null);
  // Se activa si alguna página de la búsqueda actual vino del respaldo.
  readonly desdeRespaldo = signal(false);
  // La búsqueda lleva más de 5 s: probablemente el servidor está despertando.
  readonly despertando = signal(false);
  readonly hayMas = computed(() => this.resultados().length < this.total());

  readonly minCaracteres = MIN_CARACTERES;
  readonly etiquetaAlergeno = etiquetaAlergeno;

  private consultas = new Subject<string>();

  constructor() {
    // switchMap cancela la búsqueda anterior: una respuesta tardía nunca
    // pisa los resultados de una consulta más nueva.
    this.consultas
      .pipe(
        distinctUntilChanged(),
        tap((q) => this.reiniciar(q)),
        switchMap((q) =>
          q.length < MIN_CARACTERES ? EMPTY : this.buscarPrimeraPagina(q),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  buscar(texto: string): void {
    this.consultas.next(texto.trim());
  }

  cargarMas(): void {
    const q = this.consulta();
    this.cargandoMas.set(true);
    this.error.set(null);

    this.productsService
      .buscar(q, TAMANO_PAGINA, this.resultados().length)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ respuesta, desdeRespaldo }) => {
          // Si el usuario ya cambió la consulta, esta página no le corresponde.
          if (this.consulta() !== q) {
            return;
          }
          this.resultados.update((actuales) => [...actuales, ...respuesta.resultados]);
          this.total.set(respuesta.total);
          if (desdeRespaldo) {
            this.desdeRespaldo.set(true);
          }
          this.cargandoMas.set(false);
        },
        error: (error: ErrorApi) => {
          if (this.consulta() === q) {
            this.error.set(error.mensaje);
            this.cargandoMas.set(false);
          }
        },
      });
  }

  // defer: el temporizador del aviso empieza al suscribirse, y finalize lo
  // limpia al terminar o cuando switchMap cancela la búsqueda.
  private buscarPrimeraPagina(q: string) {
    return defer(() => {
      const aviso = setTimeout(() => this.despertando.set(true), ESPERA_DESPERTAR_MS);
      return this.productsService.buscar(q, TAMANO_PAGINA, 0).pipe(
        tap(({ respuesta, desdeRespaldo }) => {
          this.resultados.set(respuesta.resultados);
          this.total.set(respuesta.total);
          this.desdeRespaldo.set(desdeRespaldo);
          this.buscado.set(true);
          this.cargando.set(false);
        }),
        catchError((error: ErrorApi) => {
          this.error.set(error.mensaje);
          this.cargando.set(false);
          return EMPTY;
        }),
        finalize(() => {
          clearTimeout(aviso);
          this.despertando.set(false);
        }),
      );
    });
  }

  private reiniciar(q: string): void {
    this.consulta.set(q);
    this.resultados.set([]);
    this.total.set(0);
    this.buscado.set(false);
    this.error.set(null);
    this.desdeRespaldo.set(false);
    this.cargandoMas.set(false);
    this.cargando.set(q.length >= MIN_CARACTERES);
  }
}
