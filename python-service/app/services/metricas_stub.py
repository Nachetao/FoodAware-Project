"""Métricas de ejemplo leídas de fixtures; serán reales en el Bloque 5."""
import json
from functools import lru_cache
from pathlib import Path

from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@lru_cache
def _datos() -> dict:
    ruta = _FIXTURES / "metricas.json"
    return json.loads(ruta.read_text(encoding="utf-8"))


def metricas_calidad() -> MetricasCalidad:
    return MetricasCalidad.model_validate(_datos()["metricas_calidad"])


def metricas_evaluacion() -> MetricasEvaluacion:
    return MetricasEvaluacion.model_validate(_datos()["metricas_evaluacion"])
