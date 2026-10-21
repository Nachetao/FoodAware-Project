"""Índice invertido y ranking Okapi BM25 de un solo campo.

Este módulo no sabe de productos ni de texto: recibe documentos ya
tokenizados (identificador -> lista de términos) y responde puntajes.

Fórmula
-------
Para una consulta Q y un documento D:

    score(D, Q) = Σ_{t ∈ Q}  idf(t) · tf(t, D) · (k1 + 1)
                              ─────────────────────────────────────────
                              tf(t, D) + k1 · (1 − b + b · |D| / avgdl)

- tf(t, D): veces que el término t aparece en D.
- |D|: largo de D en términos; avgdl: largo promedio de la colección.
- idf(t) = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5)), con N documentos y
  df(t) documentos que contienen t. Un término raro (df chico) pesa más que
  uno que está en todas partes. El "1 +" (variante de Lucene) evita que el
  idf sea negativo cuando t aparece en más de la mitad de los documentos.
- k1 controla la saturación de tf: la segunda aparición de un término suma
  menos que la primera. Con k1 = 0 solo importa si el término está o no.
- b controla la normalización por largo: con b = 1 un documento el doble de
  largo que el promedio se penaliza por completo; con b = 0 no se penaliza.

Ejemplo numérico (k1 = 1.5, b = 0.75, N = 3 documentos):
    "avena" aparece en 1 documento:  idf = ln(1 + 2.5 / 1.5) = 0.981
    "azucar" aparece en los 3:       idf = ln(1 + 0.5 / 3.5) = 0.134
    Documento con tf = 1 y largo igual al promedio (|D| / avgdl = 1):
        tf · 2.5 / (1 + 1.5 · 1) = 1.000        -> score = 0.981
    Mismo tf, pero el doble de largo (|D| / avgdl = 2):
        tf · 2.5 / (1 + 1.5 · 1.75) = 0.690     -> score = 0.676
    El documento más largo baja porque una mención en un texto largo es
    menos significativa que en uno corto.
"""
import math
from collections import Counter
from dataclasses import dataclass
from typing import Dict, Iterable, Mapping, Sequence


@dataclass(frozen=True)
class ParametrosBM25:
    k1: float = 1.5
    b: float = 0.75

    def __post_init__(self) -> None:
        if self.k1 < 0:
            raise ValueError("k1 no puede ser negativo")
        if not 0 <= self.b <= 1:
            raise ValueError("b debe estar entre 0 y 1")


class IndiceBM25:
    """Índice invertido de un campo con puntaje BM25.

    Guarda, para cada término, en qué documentos aparece y cuántas veces
    (las "postings"), y el largo de cada documento. Así una consulta solo
    recorre los documentos que contienen alguno de sus términos.
    """

    def __init__(
        self,
        documentos: Mapping[str, Sequence[str]],
        parametros: ParametrosBM25 = ParametrosBM25(),
    ) -> None:
        self.parametros = parametros
        # término -> {id del documento -> tf}
        self.postings: Dict[str, Dict[str, int]] = {}
        # id del documento -> cantidad de términos (|D|)
        self.largos: Dict[str, int] = {}
        for doc_id, terminos in documentos.items():
            self.largos[doc_id] = len(terminos)
            for termino, tf in Counter(terminos).items():
                self.postings.setdefault(termino, {})[doc_id] = tf
        self.n_documentos = len(self.largos)
        # Los documentos con el campo vacío cuentan con largo 0.
        self.largo_promedio = (
            sum(self.largos.values()) / self.n_documentos
            if self.n_documentos else 0.0
        )

    def df(self, termino: str) -> int:
        """Cantidad de documentos que contienen el término."""
        return len(self.postings.get(termino, {}))

    def idf(self, termino: str) -> float:
        df = self.df(termino)
        return math.log(1 + (self.n_documentos - df + 0.5) / (df + 0.5))

    def peso_tf(self, tf: int, largo: int) -> float:
        """Parte de tf saturada y normalizada por el largo del documento."""
        k1, b = self.parametros.k1, self.parametros.b
        # Si todos los documentos tienen el campo vacío no hay postings y
        # esto no se llama; el guard evita dividir por cero igual.
        relativo = largo / self.largo_promedio if self.largo_promedio else 0
        return tf * (k1 + 1) / (tf + k1 * (1 - b + b * relativo))

    def puntuar(self, terminos: Iterable[str]) -> Dict[str, float]:
        """Puntaje BM25 de cada documento que contiene algún término.

        Los términos repetidos en la consulta cuentan una sola vez. Los
        documentos sin coincidencias no aparecen (su puntaje sería 0).
        """
        puntajes: Dict[str, float] = {}
        for termino in set(terminos):
            postings = self.postings.get(termino)
            if not postings:
                continue
            idf = self.idf(termino)
            for doc_id, tf in postings.items():
                aporte = idf * self.peso_tf(tf, self.largos[doc_id])
                puntajes[doc_id] = puntajes.get(doc_id, 0.0) + aporte
        return puntajes
