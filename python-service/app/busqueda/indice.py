"""Índice de búsqueda por campos: suma ponderada de BM25.

Cada campo (nombre, marca, ingredientes, categorías) tiene su propio índice
invertido, con su propio idf y largo promedio. El puntaje de un producto es

    score = Σ_campo peso(campo) · BM25_campo(consulta, producto)

Ejemplo: si "avena" da BM25 = 0.98 en el nombre de un producto y 0.98 en
los ingredientes de otro, el primero suma 3 · 0.98 = 2.94 y el segundo
1 · 0.98 = 0.98: aparecer en el nombre indica mejor de qué es el producto.

Es la única puerta de entrada al texto: documentos y consultas pasan por la
misma tokenizar(), así "Galletas de AVENA" y "galleta avena" coinciden.
"""
from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional

from app.busqueda.bm25 import IndiceBM25, ParametrosBM25
from app.procesamiento.texto import tokenizar

PESOS_POR_DEFECTO: Mapping[str, float] = {
    "nombre": 3.0,
    "marca": 2.0,
    "ingredientes": 1.0,
    "categorias": 1.5,
}


@dataclass(frozen=True)
class Documento:
    """Un producto como lo ve el buscador: texto por campo."""

    id: str  # código de barras
    campos: Mapping[str, str]


@dataclass(frozen=True)
class Coincidencia:
    id: str
    score: float
    # Aporte ya ponderado de cada campo; útil para explicar el ranking.
    por_campo: Mapping[str, float]


class IndiceBusqueda:
    def __init__(
        self,
        documentos: Iterable[Documento] = (),
        *,
        pesos: Optional[Mapping[str, float]] = None,
        parametros: ParametrosBM25 = ParametrosBM25(),
    ) -> None:
        self.pesos = dict(PESOS_POR_DEFECTO if pesos is None else pesos)
        self.parametros = parametros
        documentos = list(documentos)
        self.ids = [d.id for d in documentos]
        # Un índice invertido por campo; un campo ausente es texto vacío.
        self.campos: Dict[str, IndiceBM25] = {
            campo: IndiceBM25(
                {d.id: tokenizar(d.campos.get(campo, "")) for d in documentos},
                parametros,
            )
            for campo in self.pesos
        }

    @property
    def n_documentos(self) -> int:
        return len(self.ids)

    @property
    def vacio(self) -> bool:
        return not self.ids

    def terminos_distintos(self) -> int:
        """Vocabulario total, sin contar dos veces un término de dos
        campos."""
        vocabulario = set()
        for indice in self.campos.values():
            vocabulario.update(indice.postings)
        return len(vocabulario)

    def largos_promedio(self) -> Dict[str, float]:
        return {c: i.largo_promedio for c, i in self.campos.items()}

    def buscar(self, consulta: str) -> List[Coincidencia]:
        """Documentos con score > 0, del más al menos relevante (en empate,
        por id). Una consulta sin términos útiles (solo stopwords) no
        devuelve nada."""
        terminos = tokenizar(consulta)
        if not terminos:
            return []
        por_documento: Dict[str, Dict[str, float]] = {}
        for campo, indice in self.campos.items():
            peso = self.pesos[campo]
            for doc_id, puntaje in indice.puntuar(terminos).items():
                aportes = por_documento.setdefault(doc_id, {})
                aportes[campo] = peso * puntaje
        coincidencias = [
            Coincidencia(id=doc_id, score=sum(aportes.values()),
                         por_campo=aportes)
            for doc_id, aportes in por_documento.items()
        ]
        coincidencias = [c for c in coincidencias if c.score > 0]
        coincidencias.sort(key=lambda c: (-c.score, c.id))
        return coincidencias
