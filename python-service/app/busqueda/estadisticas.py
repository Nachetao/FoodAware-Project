"""Resumen del corpus de búsqueda: qué productos hay y cómo es el índice."""
from collections import Counter
from dataclasses import dataclass, field
from typing import Any
from typing import Counter as CounterType
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.busqueda.buscador import Instantanea
from app.schemas.producto import Producto

Registro = Tuple[Producto, Optional[Mapping[str, Any]]]


@dataclass
class EstadisticasCorpus:
    total_productos: int = 0
    validos: int = 0
    # Categoría configurada -> productos válidos que la tienen. Un producto
    # puede estar en varias, así que la suma puede superar a `validos`.
    por_categoria: Dict[str, int] = field(default_factory=dict)
    # Válidos que no tienen ninguna de las categorías configuradas.
    sin_categoria_configurada: int = 0
    # Todas las categorías de OFF de los válidos, para ver qué más hay.
    categorias_frecuentes: CounterType[str] = field(default_factory=Counter)
    terminos_distintos: int = 0
    # Términos promedio por campo y por producto (suma de los campos).
    largo_promedio: Dict[str, float] = field(default_factory=dict)
    largo_promedio_total: float = 0.0


def calcular_estadisticas(
    registros: Iterable[Registro], categorias: Sequence[str]
) -> EstadisticasCorpus:
    registros = list(registros)
    instantanea = Instantanea.construir(registros)
    indice = instantanea.indice
    resumen = EstadisticasCorpus(
        total_productos=len(registros),
        validos=indice.n_documentos,
        por_categoria={c: 0 for c in categorias},
        terminos_distintos=indice.terminos_distintos(),
        largo_promedio=indice.largos_promedio(),
    )
    # Todos los campos se promedian sobre los mismos productos, así que la
    # suma de los promedios es el largo promedio de un producto completo.
    resumen.largo_promedio_total = sum(resumen.largo_promedio.values())
    for producto, payload in registros:
        if producto.codigo_barras not in instantanea.productos:
            continue  # solo cuentan los indexados (válidos)
        etiquetas = _etiquetas(payload)
        resumen.categorias_frecuentes.update(etiquetas)
        presentes = [c for c in categorias if c in etiquetas]
        for categoria in presentes:
            resumen.por_categoria[categoria] += 1
        if not presentes:
            resumen.sin_categoria_configurada += 1
    return resumen


def _etiquetas(payload: Optional[Mapping[str, Any]]) -> List[str]:
    etiquetas = (payload or {}).get("categories_tags")
    if not isinstance(etiquetas, list):
        return []
    return [e for e in etiquetas if isinstance(e, str)]
