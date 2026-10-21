"""Línea base de la evaluación: un resultado guardado para comparar.

Cuando cambia el buscador (por ejemplo, el tokenizador), se vuelve a evaluar
y se compara consulta por consulta con la línea base. Solo es comparable si
usa el mismo K y la misma versión del conjunto de evaluación: si no, se
estarían comparando preguntas o pantallas distintas.

Se guardan los aciertos y relevantes (enteros), no solo los porcentajes, para
que la comparación sea exacta.
"""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Mapping, Optional

from app.evaluacion.evaluador import ResultadoEvaluacion

RUTA_LINEA_BASE = Path(__file__).with_name("linea_base.json")
GRUPOS = ("producto", "restriccion", "global")


@dataclass(frozen=True)
class MedicionConsulta:
    relevantes: int
    aciertos: int
    precision: float
    recall: Optional[float]
    tiempo_ms: float


@dataclass(frozen=True)
class MedicionGrupo:
    consultas: int
    precision: float
    recall: float
    tiempo_ms: float


@dataclass(frozen=True)
class LineaBase:
    descripcion: str
    fecha: str
    k: int
    version_conjunto: int
    total_productos: int
    consultas: Mapping[str, MedicionConsulta]
    grupos: Mapping[str, MedicionGrupo]

    def motivo_no_comparable(
        self, resultado: ResultadoEvaluacion
    ) -> Optional[str]:
        if self.k != resultado.k:
            return f"usa K = {self.k} y esta evaluación K = {resultado.k}"
        if self.version_conjunto != resultado.version_conjunto:
            return (f"usa la versión {self.version_conjunto} del conjunto y "
                    f"esta evaluación la {resultado.version_conjunto}")
        return None


def a_dict(resultado: ResultadoEvaluacion, descripcion: str,
           fecha: str) -> Dict:
    return {
        "descripcion": descripcion,
        "fecha": fecha,
        "k": resultado.k,
        "version_conjunto": resultado.version_conjunto,
        "total_productos": resultado.total_productos,
        "consultas": {
            r.consulta.id: {
                "relevantes": r.relevantes,
                "aciertos": r.aciertos,
                "precision": r.precision,
                "recall": r.recall,
                "tiempo_ms": round(r.tiempo_ms, 3),
            }
            for r in resultado.por_consulta
        },
        "grupos": {
            grupo: {
                "consultas": p.consultas,
                "precision": p.precision,
                "recall": p.recall,
                "tiempo_ms": round(p.tiempo_ms, 3),
            }
            for grupo, p in (
                (g, resultado.promedio(None if g == "global" else g))
                for g in GRUPOS
            )
        },
    }


def guardar(ruta: Path, resultado: ResultadoEvaluacion, descripcion: str,
            fecha: str) -> None:
    Path(ruta).write_text(
        json.dumps(a_dict(resultado, descripcion, fecha),
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def cargar(ruta: Path = RUTA_LINEA_BASE) -> LineaBase:
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    return LineaBase(
        descripcion=datos["descripcion"],
        fecha=datos["fecha"],
        k=datos["k"],
        version_conjunto=datos["version_conjunto"],
        total_productos=datos["total_productos"],
        consultas={i: MedicionConsulta(**m)
                   for i, m in datos["consultas"].items()},
        grupos={g: MedicionGrupo(**m) for g, m in datos["grupos"].items()},
    )
