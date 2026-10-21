"""Corre el conjunto de evaluación contra el buscador.

Para cada consulta: calcula los relevantes del corpus con su regla, pide al
buscador los primeros K resultados (midiendo el tiempo) y calcula
Precision@K y Recall@K. Luego promedia (macro) por tipo de consulta y en
total, sin contar las consultas que no tienen relevantes en el corpus.
"""
import time
from dataclasses import dataclass
from typing import (
    Any, Callable, List, Mapping, Optional, Sequence, Tuple,
)

from app.busqueda.buscador import Instantanea
from app.evaluacion.conjunto import (
    ConjuntoEvaluacion,
    ConsultaEvaluacion,
    relevantes,
)
from app.evaluacion.metricas import (
    aciertos,
    precision_at_k,
    promedio_macro,
    recall_at_k,
)
from app.schemas.producto import Producto

K_POR_DEFECTO = 5

Registro = Tuple[Producto, Optional[Mapping[str, Any]]]
# Recibe la consulta y K; devuelve los códigos de barras en orden.
Buscador = Callable[[str, int], Sequence[str]]


@dataclass(frozen=True)
class ResultadoConsulta:
    consulta: ConsultaEvaluacion
    relevantes: int  # en todo el corpus
    aciertos: int  # relevantes entre los primeros K
    precision: float
    recall: Optional[float]  # None si no hay relevantes
    tiempo_ms: float
    resultados: Tuple[str, ...]  # los primeros K, en orden

    @property
    def evaluada(self) -> bool:
        return self.relevantes > 0


@dataclass(frozen=True)
class Promedio:
    consultas: int
    precision: float
    recall: float
    tiempo_ms: float


@dataclass(frozen=True)
class ResultadoEvaluacion:
    k: int
    version_conjunto: int
    total_productos: int
    por_consulta: Tuple[ResultadoConsulta, ...]

    @property
    def evaluadas(self) -> List[ResultadoConsulta]:
        return [r for r in self.por_consulta if r.evaluada]

    @property
    def excluidas(self) -> List[ResultadoConsulta]:
        """Sin relevantes en el corpus: no entran en los promedios."""
        return [r for r in self.por_consulta if not r.evaluada]

    def promedio(self, tipo: Optional[str] = None) -> Promedio:
        """Promedio macro de las evaluadas (de un tipo, o de todas)."""
        grupo = [r for r in self.evaluadas
                 if tipo is None or r.consulta.tipo == tipo]
        return Promedio(
            consultas=len(grupo),
            precision=promedio_macro([r.precision for r in grupo]),
            recall=promedio_macro([r.recall for r in grupo]),
            tiempo_ms=promedio_macro([r.tiempo_ms for r in grupo]),
        )


def evaluar(
    conjunto: ConjuntoEvaluacion,
    corpus: Sequence[Registro],
    buscar: Buscador,
    k: int = K_POR_DEFECTO,
    reloj: Callable[[], float] = time.perf_counter,
) -> ResultadoEvaluacion:
    """`corpus` debe ser lo mismo que indexa el buscador (los válidos): los
    relevantes se cuentan ahí."""
    por_consulta = []
    for consulta in conjunto.consultas:
        relevantes_ = relevantes(consulta.regla, corpus)
        inicio = reloj()
        resultados = tuple(buscar(consulta.consulta, k))[:k]
        tiempo_ms = (reloj() - inicio) * 1000
        por_consulta.append(ResultadoConsulta(
            consulta=consulta,
            relevantes=len(relevantes_),
            aciertos=aciertos(resultados, relevantes_, k),
            precision=precision_at_k(resultados, relevantes_, k),
            recall=recall_at_k(resultados, relevantes_, k),
            tiempo_ms=tiempo_ms,
            resultados=resultados,
        ))
    return ResultadoEvaluacion(
        k=k,
        version_conjunto=conjunto.version,
        total_productos=len(corpus),
        por_consulta=tuple(por_consulta),
    )


def evaluar_instantanea(
    conjunto: ConjuntoEvaluacion,
    registros: Sequence[Registro],
    instantanea: Instantanea,
    k: int = K_POR_DEFECTO,
) -> ResultadoEvaluacion:
    """Evalúa el índice BM25 tal como lo usa GET /search.

    Los registros aportan el payload (las categorías) de cada producto; el
    corpus son solo los que están en el índice.
    """
    corpus = [(p, payload) for p, payload in registros
              if p.codigo_barras in instantanea.productos]

    def buscar(consulta: str, limite: int) -> List[str]:
        _, pagina = instantanea.buscar(consulta, limite, 0)
        return [r.producto.codigo_barras for r in pagina]

    return evaluar(conjunto, corpus, buscar, k)
