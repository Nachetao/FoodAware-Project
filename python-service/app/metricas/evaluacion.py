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
from typing import Optional

from app.evaluacion.adaptativa import (
    DeteccionCampo,
    ResultadoEvaluacionAdaptativa,
)
from app.evaluacion.evaluador import ResultadoEvaluacion
from app.schemas.metricas import (
    ORIGEN_ETIQUETADO,
    ComparacionConsultaRestriccion,
    DeteccionAlergenos,
    EvaluacionBusquedaAdaptativa,
    EvaluacionDeteccion,
    EvaluacionPerfilPrueba,
    MetricasEvaluacion,
    MetricasEvaluacionAdaptativa,
    ResumenEtiquetado,
)

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


def metricas_evaluacion_adaptativa(
    resultado: ResultadoEvaluacionAdaptativa,
) -> MetricasEvaluacionAdaptativa:
    """GET /metrics/evaluation/adaptive: la evaluación de la capacidad
    adaptativa del índice publicado (ver app.evaluacion.adaptativa)."""
    return MetricasEvaluacionAdaptativa(
        etiquetado=ResumenEtiquetado(
            productos_revisados=resultado.revisados,
            productos_evaluados=resultado.evaluados,
            no_encontrados=list(resultado.no_encontrados),
            origen=ORIGEN_ETIQUETADO,
        ),
        deteccion=EvaluacionDeteccion(
            alergenos=_deteccion(resultado.deteccion_alergenos),
            trazas=_deteccion(resultado.deteccion_trazas),
        ),
        veredictos=[
            EvaluacionPerfilPrueba(
                perfil=p.perfil,
                modo=p.modo,
                productos=p.productos,
                contienen=p.contienen,
                falsos_apto=len(p.falsos_apto),
                tasa_falsos_apto=_redondear(p.tasa_falsos_apto),
                falsos_apto_por_traza=len(p.falsos_apto_por_traza),
                productos_completos=p.productos_completos,
                falsos_no_apto=len(p.falsos_no_apto),
                tasa_falsos_no_apto=_redondear(p.tasa_falsos_no_apto),
                coincidencias=p.coincidencias,
                matriz=p.matriz,
            )
            for p in resultado.perfiles
        ],
        busqueda=EvaluacionBusquedaAdaptativa(
            k=resultado.k,
            consultas_evaluadas=len(resultado.consultas_evaluadas),
            precision_base=round(resultado.precision_base,
                                 DECIMALES_PROPORCION),
            precision_personalizada=round(resultado.precision_personalizada,
                                          DECIMALES_PROPORCION),
            no_aptos_top_base=resultado.no_aptos_top_base,
            no_aptos_top_personalizado=resultado.no_aptos_top_personalizado,
            consultas=[
                ComparacionConsultaRestriccion(
                    id=c.consulta.id,
                    consulta=c.consulta.consulta,
                    relevantes=c.relevantes,
                    precision_base=round(c.precision_base,
                                         DECIMALES_PROPORCION),
                    precision_personalizada=round(c.precision_personalizada,
                                                  DECIMALES_PROPORCION),
                    no_aptos_top_base=c.no_aptos_top_base,
                    no_aptos_top_personalizado=c.no_aptos_top_personalizado,
                )
                for c in resultado.consultas
            ],
        ),
    )


def _deteccion(campo: DeteccionCampo) -> DeteccionAlergenos:
    return DeteccionAlergenos(
        productos=campo.productos,
        verdaderos_positivos=campo.verdaderos_positivos,
        falsos_positivos=campo.falsos_positivos,
        falsos_negativos=campo.falsos_negativos,
        precision=_redondear(campo.precision),
        exhaustividad=_redondear(campo.exhaustividad),
    )


def _redondear(valor: Optional[float]) -> Optional[float]:
    return None if valor is None else round(valor, DECIMALES_PROPORCION)
