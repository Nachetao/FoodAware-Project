import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ProductsService } from '../products/products.service';
import { etiquetaAlergeno, etiquetaDieta } from '../products/models/alergenos';
import { Compatibilidad } from '../products/models/compatibilidad';
import { ErrorApi } from '../products/models/error';
import { Producto } from '../products/models/producto';
import { esProblemaDeAlergenos, explicarProblema } from '../products/models/problemas';
import { fecha } from '../metricas/formato';

@Component({
  selector: 'app-producto',
  templateUrl: 'producto.page.html',
  styleUrls: ['producto.page.scss'],
  standalone: false,
})
export class ProductoPage implements OnInit {
  private ruta = inject(ActivatedRoute);
  private productsService = inject(ProductsService);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);

  readonly producto = signal<Producto | null>(null);
  readonly desdeRespaldo = signal(false);
  readonly cargando = signal(true);
  readonly error = signal<ErrorApi | null>(null);
  readonly noEncontrado = computed(() => this.error()?.codigo === 'NOT_FOUND');

  // Franja "Apto para ti" / "No apto": solo con sesión. Si la consulta falla,
  // el detalle se muestra igual, sin franja.
  private readonly compatibilidad = signal<Compatibilidad | null>(null);
  readonly franja = computed(() => {
    const c = this.auth.autenticado() ? this.compatibilidad() : null;
    if (!c) {
      return null;
    }
    return {
      apto: c.apto,
      conflictos: c.alergenos_en_conflicto.map(etiquetaAlergeno).join(', '),
      trazas: c.trazas_en_conflicto.map(etiquetaAlergeno).join(', '),
    };
  });

  // calidad.problemas separados en los que explican los alérgenos y el resto.
  private readonly problemas = computed(() => this.producto()?.calidad.problemas ?? []);
  readonly motivosAlergenos = computed(() =>
    this.problemas().filter(esProblemaDeAlergenos).map(explicarProblema),
  );
  // alergenos y trazas son la unión de las etiquetas de Open Food Facts y lo
  // detectado en el texto: los que no se detectaron en el texto vienen de OFF.
  readonly informadosPorFuente = computed(() => {
    const producto = this.producto();
    if (!producto) {
      return [];
    }
    const enTexto = new Set(
      this.problemas()
        .filter((p) => /^(alergeno_detectado_en_texto|traza_detectada_en_texto):/.test(p))
        .map((p) => p.split(':')[1]),
    );
    return [...new Set([...producto.alergenos, ...producto.trazas])]
      .filter((codigo) => !enTexto.has(codigo))
      .map(etiquetaAlergeno);
  });
  readonly otrosProblemas = computed(() =>
    this.problemas()
      .filter((p) => !esProblemaDeAlergenos(p))
      .map(explicarProblema),
  );

  readonly etiquetaAlergeno = etiquetaAlergeno;
  readonly etiquetaDieta = etiquetaDieta;
  readonly fecha = fecha;

  private codigo = '';

  ngOnInit(): void {
    this.ruta.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.codigo = params.get('codigo') ?? '';
      this.cargar();
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.cargarCompatibilidad();
    this.productsService
      .obtener(this.codigo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ producto, desdeRespaldo }) => {
          this.producto.set(producto);
          this.desdeRespaldo.set(desdeRespaldo);
          this.cargando.set(false);
        },
        error: (error: ErrorApi) => {
          this.producto.set(null);
          this.error.set(error);
          this.cargando.set(false);
        },
      });
  }

  private cargarCompatibilidad(): void {
    this.compatibilidad.set(null);
    if (!this.auth.autenticado()) {
      return;
    }
    const codigo = this.codigo;
    this.productsService
      .compatibilidad(codigo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (compatibilidad) => {
          // Si la ruta ya cambió de producto, esta respuesta no le corresponde.
          if (this.codigo === codigo) {
            this.compatibilidad.set(compatibilidad);
          }
        },
        error: () => undefined,
      });
  }
}
