import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Subject, of, throwError } from 'rxjs';
import type { Mock } from 'vitest';

import { MetricasPage } from './metricas.page';
import { MetricasPageModule } from './metricas.module';
import { MetricasService } from '../products/metricas.service';
import {
  MetricasCalidad,
  MetricasEvaluacion,
  ResumenIngesta,
} from '../products/models/metricas';
import { ErrorApi } from '../products/models/error';

const CALIDAD: MetricasCalidad = {
  porcentaje_validos: 92,
  porcentaje_duplicados: 5,
  cobertura_ingredientes: 87.5,
  antiguedad_promedio_horas: 18.2,
  total_productos: 1240,
};
const EVALUACION: MetricasEvaluacion = {
  k: 5,
  precision_at_k: 0.51,
  recall_at_k: 0.48,
  consultas_evaluadas: 20,
  tiempo_promedio_ms: 14.3,
};
const INGESTA: ResumenIngesta = {
  run_id: '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b',
  inicio: '2026-10-20T14:00:00Z',
  fin: '2026-10-20T14:02:30Z',
  duracion_ms: 150000,
  recuperados: 100,
  validos: 92,
  invalidos: 8,
  duplicados: 5,
  errores: 1,
  estado: 'completado_con_errores',
};

function errorApi(status: number, codigo: ErrorApi['codigo'], mensaje: string): ErrorApi {
  return { status, codigo, mensaje, requestId: 'r' };
}

describe('MetricasPage', () => {
  let fixture: ComponentFixture<MetricasPage>;
  let servicio: { calidad: Mock; evaluacion: Mock; ultimaIngesta: Mock };

  async function crear() {
    await TestBed.configureTestingModule({
      imports: [IonicModule.forRoot(), MetricasPageModule],
      providers: [provideRouter([]), { provide: MetricasService, useValue: servicio }],
    }).compileComponents();
    fixture = TestBed.createComponent(MetricasPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    servicio = {
      calidad: vi.fn(() => of(CALIDAD)),
      evaluacion: vi.fn(() => of(EVALUACION)),
      ultimaIngesta: vi.fn(() => of(INGESTA)),
    };
  });

  // Texto visible de una tarjeta: une con espacios el texto de cada elemento
  // hoja (dt, dd, p…), porque textContent los pegaría ("Válidos92").
  function texto(selector: string): string {
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector(selector);
    if (!el) return '';
    const hojas = [el, ...Array.from(el.querySelectorAll('*'))].filter(
      (e) => e.children.length === 0,
    );
    return hojas
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
  }

  it('muestra la calidad de los datos con formato', async () => {
    await crear();
    const calidad = texto('.tarjeta-calidad');

    expect(calidad).toContain('Registros válidos 92 %');
    expect(calidad).toContain('Duplicados 5 %');
    expect(calidad).toContain('Cobertura de ingredientes 87,5 %');
    expect(calidad).toContain('Productos disponibles 1.240');
    expect(calidad).toContain('18,2 h');
  });

  it('muestra la evaluación con Precision@K, Recall@K y su explicación', async () => {
    await crear();
    const evaluacion = texto('.tarjeta-evaluacion');

    expect(evaluacion).toContain('Precision@5 51 %');
    expect(evaluacion).toContain('Recall@5 48 %');
    expect(evaluacion).toContain('De los 5 primeros resultados');
    expect(evaluacion).toContain('Consultas evaluadas 20');
    expect(evaluacion).toContain('14,3 ms');
  });

  it('muestra la última ingesta con su estado, duración y conteos', async () => {
    await crear();
    const ingesta = texto('.tarjeta-ingesta');

    expect(ingesta).toContain('Completada con errores');
    expect(ingesta).toContain('2 min 30 s');
    expect(ingesta).toContain('Recuperados 100');
    expect(ingesta).toContain('Válidos 92');
    expect(ingesta).toContain('Inválidos 8');
    expect(ingesta).toContain('Duplicados 5');
    expect(ingesta).toContain('Errores 1');
  });

  it('muestra un spinner mientras carga', async () => {
    servicio.calidad.mockReturnValue(new Subject());
    await crear();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.tarjeta-calidad ion-spinner'),
    ).not.toBeNull();
  });

  it('indica que no hay ingestas ante NOT_FOUND, sin afectar las otras tarjetas', async () => {
    servicio.ultimaIngesta.mockReturnValue(
      throwError(() => errorApi(404, 'NOT_FOUND', 'No hay ejecuciones')),
    );
    await crear();

    expect(texto('.tarjeta-ingesta')).toContain('Todavía no hay ninguna ingesta.');
    expect(texto('.tarjeta-ingesta [role="alert"]')).toBe('');
    expect(texto('.tarjeta-calidad')).toContain('92 %');
  });

  it('muestra el mensaje del contrato si una métrica falla', async () => {
    servicio.evaluacion.mockReturnValue(
      throwError(() =>
        errorApi(503, 'SOURCE_UNAVAILABLE', 'El servicio de búsqueda no está disponible'),
      ),
    );
    await crear();

    expect(texto('.tarjeta-evaluacion [role="alert"]')).toBe(
      'El servicio de búsqueda no está disponible',
    );
  });

  it('el botón actualizar vuelve a pedir las tres métricas', async () => {
    await crear();
    servicio.calidad.mockReturnValue(of({ ...CALIDAD, total_productos: 2000 }));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('ion-button[aria-label="Actualizar métricas"]')!
      .click();

    expect(servicio.calidad).toHaveBeenCalledTimes(2);
    expect(servicio.evaluacion).toHaveBeenCalledTimes(2);
    expect(servicio.ultimaIngesta).toHaveBeenCalledTimes(2);
    expect(texto('.tarjeta-calidad')).toContain('Productos disponibles 2.000');
  });
});
