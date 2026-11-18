"""Ranking personalizado sobre una instantánea del buscador.

Función pura que comparten POST /search/personalized y la evaluación de la
capacidad adaptativa, así lo que se evalúa es exactamente lo que responde
el endpoint:

1. Interpreta las restricciones de la consulta y las suma al perfil.
2. Busca con BM25 la consulta sin esas restricciones (o la completa, si
   solo traía restricciones), con todas las coincidencias.
3. Le pone un veredicto a cada producto y ordena por veredicto (apto,
   apto_con_advertencia, no_apto) y después por score.
"""
from dataclasses import dataclass
from typing import List, Tuple

from app.adaptativo.consulta import ConsultaInterpretada, interpretar
from app.adaptativo.veredicto import evaluar_veredicto
from app.busqueda.buscador import Instantanea
from app.procesamiento.texto import tokenizar
from app.schemas.adaptativo import (
    ModoBusqueda,
    PerfilRestricciones,
    Veredicto,
)
from app.schemas.busqueda import ResultadoBusqueda

RANGO_VEREDICTO = {"apto": 0, "apto_con_advertencia": 1, "no_apto": 2}

Evaluado = Tuple[ResultadoBusqueda, Veredicto]


@dataclass(frozen=True)
class RankingPersonalizado:
    consulta: ConsultaInterpretada
    perfil: PerfilRestricciones  # el recibido más las restricciones
    texto: str  # lo que se buscó con BM25
    ordenados: List[Evaluado]  # todas las coincidencias, ya ordenadas

    def visibles(self, modo: ModoBusqueda) -> List[Evaluado]:
        """En modo filtrar, sin los no_apto."""
        if modo != "filtrar":
            return list(self.ordenados)
        return [e for e in self.ordenados if e[1].veredicto != "no_apto"]

    @property
    def no_aptos(self) -> List[Veredicto]:
        return [v for _, v in self.ordenados if v.veredicto == "no_apto"]


def rankear(instantanea: Instantanea, consulta: str,
            perfil: PerfilRestricciones) -> RankingPersonalizado:
    interpretada = interpretar(consulta)
    aplicado = interpretada.aplicar(perfil)
    texto = (interpretada.texto_busqueda
             if tokenizar(interpretada.texto_busqueda) else consulta)
    todas = max(1, len(instantanea.productos))
    _, coincidencias = instantanea.buscar(texto, todas, 0)
    evaluados = [(r, evaluar_veredicto(r.producto, aplicado))
                 for r in coincidencias]
    # sorted es estable y las coincidencias ya vienen por score.
    ordenados = sorted(evaluados,
                       key=lambda e: RANGO_VEREDICTO[e[1].veredicto])
    return RankingPersonalizado(interpretada, aplicado, texto, ordenados)
