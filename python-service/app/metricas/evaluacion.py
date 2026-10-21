"""Métricas de evaluación de la búsqueda (GET /metrics/evaluation).

Resumen, en la forma del contrato, de la evaluación del índice que está
respondiendo /search (ver app.evaluacion). Se calcula al reconstruir el
índice, no en cada petición.

- k: resultados que se miran por consulta (5 por defecto).
- precision_at_k: promedio macro de Precision@K, es decir, la fracción
  relevante de los primeros K resultados, promediada entre consultas.
- recall_at_k: promedio macro de Recall@K, es decir, la fracción de los
  relevantes del corpus que aparece en los primeros K.
- consultas_evaluadas: consultas del conjunto con al menos un relevante
  en el corpus; las demás no entran en los promedios.
- tiempo_promedio_ms: tiempo promedio de búsqueda de esas consultas.

Ambos tipos de consulta (de producto y con restricción) entran en el
promedio global; el desglose por tipo está en scripts/evaluar_busqueda.py.
"""
from app.evaluacion.evaluador import ResultadoEvaluacion
from app.schemas.metricas import MetricasEvaluacion

DECIMALES_PROPORCION = 4
DECIMALES_TIEMPO = 3


def metricas_evaluacion(resultado: ResultadoEvaluacion) -> MetricasEvaluacion:
    promedio = resultado.promedio()
    return MetricasEvaluacion(
        k=resultado.k,
        precision_at_k=round(promedio.precision, DECIMALES_PROPORCION),
        recall_at_k=round(promedio.recall, DECIMALES_PROPORCION),
        consultas_evaluadas=promedio.consultas,
        tiempo_promedio_ms=round(promedio.tiempo_ms, DECIMALES_TIEMPO),
    )
