"""Ingesta y métricas de ejemplo leídas de fixtures."""
import json
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.schemas.metricas import MetricasCalidad, MetricasEvaluacion

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@lru_cache
def _datos() -> dict:
    ruta = _FIXTURES / "operacion.json"
    return json.loads(ruta.read_text(encoding="utf-8"))


def iniciar_ingesta(solicitud: SolicitudIngesta) -> ResumenIngesta:
    # La ingesta real será asíncrona: se responde con la ejecución creada.
    return ResumenIngesta(
        run_id=uuid.uuid4(),
        inicio=datetime.now(timezone.utc),
        recuperados=0,
        validos=0,
        invalidos=0,
        duplicados=0,
        errores=0,
        estado="en_curso",
    )


def ultima_ingesta() -> ResumenIngesta:
    return ResumenIngesta.model_validate(_datos()["ultima_ingesta"])


def metricas_calidad() -> MetricasCalidad:
    return MetricasCalidad.model_validate(_datos()["metricas_calidad"])


def metricas_evaluacion() -> MetricasEvaluacion:
    return MetricasEvaluacion.model_validate(_datos()["metricas_evaluacion"])
