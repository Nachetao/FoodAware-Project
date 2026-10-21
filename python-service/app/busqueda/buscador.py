"""Instantánea inmutable del buscador: índice + productos indexados.

Una instantánea nunca cambia después de construirse. Para actualizar la
búsqueda se construye otra completa y se reemplaza la referencia (ver
app.services.busqueda); así una búsqueda en curso termina con la instantánea
que tomó al empezar, sin ver un índice a medio construir.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, List, Mapping, Optional, Tuple

from app.busqueda.bm25 import ParametrosBM25
from app.busqueda.documentos import documentos_indexables
from app.busqueda.indice import Coincidencia, IndiceBusqueda
from app.schemas.busqueda import ResultadoBusqueda
from app.schemas.producto import Producto

# Decimales del score que se devuelve; también se usan para decidir empates.
DECIMALES_SCORE = 4


@dataclass(frozen=True)
class Instantanea:
    indice: IndiceBusqueda
    # Solo los productos indexados (válidos), por código de barras.
    productos: Mapping[str, Producto]
    construida_en: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @classmethod
    def vacia(cls) -> "Instantanea":
        return cls(indice=IndiceBusqueda(), productos={})

    @classmethod
    def construir(
        cls,
        registros: Iterable[Tuple[Producto, Optional[Mapping[str, Any]]]],
        *,
        pesos: Optional[Mapping[str, float]] = None,
        parametros: ParametrosBM25 = ParametrosBM25(),
    ) -> "Instantanea":
        """Indexa los productos válidos; el payload crudo aporta las
        categorías."""
        registros = list(registros)
        documentos = documentos_indexables(registros)
        indexados = {d.id for d in documentos}
        return cls(
            indice=IndiceBusqueda(documentos, pesos=pesos,
                                  parametros=parametros),
            productos={p.codigo_barras: p for p, _ in registros
                       if p.codigo_barras in indexados},
        )

    def buscar(
        self, consulta: str, limit: int, offset: int
    ) -> Tuple[int, List[ResultadoBusqueda]]:
        """(total antes de paginar, página de resultados).

        Orden: score descendente; en empate, completitud descendente y luego
        código de barras. El empate se decide con el score ya redondeado,
        para que el orden sea coherente con el score que se muestra.
        """
        ordenadas = sorted(self.indice.buscar(consulta), key=self._orden)
        pagina = ordenadas[offset:offset + limit]
        resultados = [
            ResultadoBusqueda(
                producto=self.productos[c.id],
                score=round(c.score, DECIMALES_SCORE),
                # Posición global: con offset 10, el primero es el 11.
                posicion=offset + i + 1,
            )
            for i, c in enumerate(pagina)
        ]
        return len(ordenadas), resultados

    def _orden(self, coincidencia: Coincidencia):
        completitud = self.productos[coincidencia.id].calidad.completitud
        return (-round(coincidencia.score, DECIMALES_SCORE), -completitud,
                coincidencia.id)
