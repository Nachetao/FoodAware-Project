import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defer,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  tap,
} from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ProductsService } from '../products/products.service';
import { ModoBusqueda } from '../products/models/busqueda-personalizada';
import { ErrorApi } from '../products/models/error';
import { Producto } from '../products/models/producto';
import {
  PresentacionVeredicto,
  presentarVeredicto,
  textoInterpretacion,
  textoNoReconocidas,
} from '../products/models/veredicto';
import { guardarPreferencias, leerPreferencias } from './preferencias-busqueda';

const TAMANO_PAGINA = 20;
const MIN_CARACTERES = 2;
// En Render (plan gratuito) el backend se duerme y la primera respuesta tarda.
const ESPERA_DESPERTAR_MS = 5000;

interface Consulta {
  q: string;
  /** true: /search/personalizada con el perfil del usuario en vez de /search. */
  personalizar: boolean;
  modo: ModoBusqueda;
}

/** Resultado listo para mostrar, venga de la búsqueda normal o la personalizada. */
export interface ResultadoVista {
  producto: Producto;
  /** Solo en la búsqueda personalizada. */
  veredicto: PresentacionVeredicto | null;
}

/** Lo que agrega la búsqueda personalizada, ya en texto para mostrar. */
interface ResumenPersonalizado {
  interpretacion: string | null;
  noReconocidas: string | null;
  /** Qué se ocultó (o se dejó al final) y por qué; null si no hay no aptos. */
  noAptos: string | null;
  aviso: string;
}

interface Pagina {
  resultados: ResultadoVista[];
  total: number;
  desdeRespaldo: boolean;
  resumen: ResumenPersonalizado | null;
}

@Component({
  selector: 'app-busqueda',
  templateUrl: 'busqueda.page.html',
  styleUrls: ['busqueda.page.scss'],
  standalone: false,
})
export class BusquedaPage {
  private productsService = inject(ProductsService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  // El interruptor "Personalizar según mi perfil" se muestra solo con sesión.
  readonly auth = inject(AuthService);

  // Signals: sin zone.js, actualizan la vista sin llamar a detectChanges().
  readonly consulta = signal('');
  // Texto del buscador puesto desde ?q= (por ejemplo, desde home). Solo
  // cambia con la URL: lo que escribe el usuario no vuelve al campo.
  readonly textoBuscador = signal('');
  readonly resultados = signal<ResultadoVista[]>([]);
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

  // Elección del usuario, recordada en localStorage.
  private readonly preferencias = leerPreferencias();
  readonly personalizar = signal(this.preferencias.personalizar);
  readonly modo = signal<ModoBusqueda>(this.preferencias.modo);
  // Sin sesión se busca como siempre, aunque la preferencia esté activada.
  readonly personalizarActivo = computed(
    () => this.auth.autenticado() && this.personalizar(),
  );

  // Modo de la búsqueda mostrada, para los textos y "Cargar más".
  private readonly buscada = signal<Consulta>({
    q: '',
    personalizar: false,
    modo: 'filtrar',
  });
  readonly buscandoPersonalizada = computed(() => this.buscada().personalizar);
  readonly resumen = signal<ResumenPersonalizado | null>(null);

  readonly minCaracteres = MIN_CARACTERES;
  // Alergias del perfil, para marcar los alérgenos que chocan con ellas. Sin
  // sesión (o mientras carga el perfil), vacía: todos en neutro.
  readonly alergiasPerfil = computed(() =>
    this.auth.autenticado() ? (this.auth.usuario()?.alergias ?? []) : [],
  );

  private consultas = new Subject<Consulta>();

  constructor() {
    // switchMap cancela la búsqueda anterior: una respuesta tardía nunca
    // pisa los resultados de una consulta más nueva.
    this.consultas
      .pipe(
        distinctUntilChanged(
          (a, b) => a.q === b.q && a.personalizar === b.personalizar && a.modo === b.modo,
        ),
        tap((consulta) => this.reiniciar(consulta)),
        switchMap((consulta) =>
          consulta.q.length < MIN_CARACTERES ? EMPTY : this.buscarPrimeraPagina(consulta),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // /busqueda?q=leche rellena el buscador y busca.
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('q')?.trim() ?? ''),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        if (q) {
          this.textoBuscador.set(q);
          this.buscar(q);
        }
      });
  }

  buscar(texto: string): void {
    this.consultas.next({
      q: texto.trim(),
      personalizar: this.personalizarActivo(),
      modo: this.modo(),
    });
  }

  /** Activa o desactiva la personalización y repite la consulta actual. */
  cambiarPersonalizar(activo: boolean): void {
    this.personalizar.set(activo);
    this.recordarYRepetir();
  }

  /** Cambia qué hacer con los no aptos y repite la consulta actual. */
  cambiarModo(modo: unknown): void {
    if (modo !== 'filtrar' && modo !== 'reordenar') {
      return;
    }
    this.modo.set(modo);
    this.recordarYRepetir();
  }

  cargarMas(): void {
    const consulta = this.buscada();
    const vigente = () => this.buscada() === consulta;
    this.cargandoMas.set(true);
    this.error.set(null);

    this.pagina(consulta, this.resultados().length)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ resultados, total, desdeRespaldo }) => {
          // Si el usuario ya cambió la consulta, esta página no le corresponde.
          if (!vigente()) {
            return;
          }
          this.resultados.update((actuales) => [...actuales, ...resultados]);
          this.total.set(total);
          if (desdeRespaldo) {
            this.desdeRespaldo.set(true);
          }
          this.cargandoMas.set(false);
        },
        error: (error: ErrorApi) => {
          if (vigente()) {
            this.error.set(error.mensaje);
            this.cargandoMas.set(false);
          }
        },
      });
  }

  private recordarYRepetir(): void {
    guardarPreferencias({ personalizar: this.personalizar(), modo: this.modo() });
    this.buscar(this.consulta());
  }

  // defer: el temporizador del aviso empieza al suscribirse, y finalize lo
  // limpia al terminar o cuando switchMap cancela la búsqueda.
  private buscarPrimeraPagina(consulta: Consulta) {
    return defer(() => {
      const aviso = setTimeout(() => this.despertando.set(true), ESPERA_DESPERTAR_MS);
      return this.pagina(consulta, 0).pipe(
        tap(({ resultados, total, desdeRespaldo, resumen }) => {
          this.resultados.set(resultados);
          this.total.set(total);
          this.desdeRespaldo.set(desdeRespaldo);
          this.resumen.set(resumen);
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

  private pagina({ q, personalizar, modo }: Consulta, offset: number): Observable<Pagina> {
    if (!personalizar) {
      return this.productsService.buscar(q, TAMANO_PAGINA, offset).pipe(
        map(({ respuesta, desdeRespaldo }) => ({
          resultados: respuesta.resultados.map(({ producto }) => ({
            producto,
            veredicto: null,
          })),
          total: respuesta.total,
          desdeRespaldo,
          resumen: null,
        })),
      );
    }
    return this.productsService.buscarPersonalizado(q, modo, TAMANO_PAGINA, offset).pipe(
      map(({ respuesta, desdeRespaldo }) => ({
        resultados: respuesta.resultados.map(({ producto, veredicto }) => ({
          producto,
          veredicto: presentarVeredicto(veredicto.veredicto),
        })),
        total: respuesta.total,
        desdeRespaldo,
        resumen: {
          interpretacion: textoInterpretacion(respuesta.interpretacion),
          noReconocidas: textoNoReconocidas(respuesta.interpretacion),
          noAptos: respuesta.no_aptos.total > 0 ? respuesta.no_aptos.texto : null,
          aviso: respuesta.aviso,
        },
      })),
    );
  }

  private reiniciar(consulta: Consulta): void {
    this.consulta.set(consulta.q);
    this.buscada.set(consulta);
    this.resultados.set([]);
    this.total.set(0);
    this.buscado.set(false);
    this.error.set(null);
    this.desdeRespaldo.set(false);
    this.resumen.set(null);
    this.cargandoMas.set(false);
    this.cargando.set(consulta.q.length >= MIN_CARACTERES);
  }
}
