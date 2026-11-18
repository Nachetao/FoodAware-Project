"""Etiquetado manual de alérgenos (etiquetado_manual.json).

Productos reales del corpus con sus alérgenos y trazas revisados a mano,
para evaluar la capacidad adaptativa sin usar la misma detección que se
evalúa. Solo cuentan los que tienen manual.revisado_por_equipo en true.

Un campo en null (no se pudo decidir) queda fuera solo de los cálculos que
lo necesitan, no el producto completo.
"""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, FrozenSet, List, Mapping, Optional

from app.schemas.enums import AllergenCode

RUTA_ETIQUETADO = Path(__file__).with_name("etiquetado_manual.json")


@dataclass(frozen=True)
class ProductoEtiquetado:
    codigo_barras: str
    nombre: str
    # None = no se pudo decidir.
    alergenos: Optional[FrozenSet[AllergenCode]]
    trazas: Optional[FrozenSet[AllergenCode]]
    revisado: bool


def cargar_etiquetado(
    ruta: Path = RUTA_ETIQUETADO,
) -> List[ProductoEtiquetado]:
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    return etiquetado_desde_dict(datos)


def etiquetado_desde_dict(
    datos: Mapping[str, Any],
) -> List[ProductoEtiquetado]:
    """Valida el archivo: un código mal escrito es un error al cargar, no
    un falso resultado al evaluar."""
    productos = [_producto(p) for p in datos["productos"]]
    codigos = [p.codigo_barras for p in productos]
    repetidos = sorted({c for c in codigos if codigos.count(c) > 1})
    if repetidos:
        raise ValueError(f"códigos repetidos en el etiquetado: {repetidos}")
    return productos


def revisados(
    productos: List[ProductoEtiquetado],
) -> List[ProductoEtiquetado]:
    return [p for p in productos if p.revisado]


def _producto(datos: Mapping[str, Any]) -> ProductoEtiquetado:
    manual = datos["manual"]
    revisado = manual.get("revisado_por_equipo", False)
    if not isinstance(revisado, bool):
        raise ValueError(f"{datos['codigo_barras']}: revisado_por_equipo "
                         "debe ser true o false")
    return ProductoEtiquetado(
        codigo_barras=str(datos["codigo_barras"]),
        nombre=str(datos.get("nombre", "")),
        alergenos=_codigos(manual.get("alergenos")),
        trazas=_codigos(manual.get("trazas")),
        revisado=revisado,
    )


def _codigos(valor: Optional[List[str]]) -> Optional[FrozenSet[AllergenCode]]:
    if valor is None:
        return None
    # AllergenCode("xyz") falla con ValueError.
    return frozenset(AllergenCode(c) for c in valor)
