"""Conjunto de evaluación: consultas y reglas de relevancia.

Por qué reglas y no códigos de barras: un juicio "este código es relevante"
solo vale para el corpus en que se escribió. Una regla ("es una galleta y
no tiene gluten") se evalúa sobre cualquier corpus, y como se aplica a
todos los productos, se conoce el conjunto completo de relevantes: así
Recall@K es exacto, no una estimación.

Una regla es un conjunto de condiciones; un producto es relevante si
cumple todas las que la regla define:

- categorias_alguna: tiene al menos una de esas categorías de Open Food
  Facts (categories_tags del payload crudo).
- nombre_alguno: su nombre contiene al menos una de esas frases.
- nombre_todos: su nombre contiene todas esas frases.
- sin_alergenos: no tiene ninguno de esos alérgenos, ni como ingrediente
  ni como traza (para un alérgico, "puede contener" tampoco sirve).
- con_alergenos: tiene todos esos alérgenos como ingrediente.

Las frases se comparan normalizadas (minúsculas, sin tildes, singular
básico) y como palabras completas: "avena instantánea" coincide con
"Avena Instantanea" pero "pan" no coincide con "panadería".
"""
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, FrozenSet, List, Mapping, Optional, Sequence, Tuple

from app.procesamiento.texto import normalizar
from app.schemas.enums import AllergenCode
from app.schemas.producto import Producto

RUTA_CONSULTAS = Path(__file__).with_name("consultas.json")
TIPOS = ("producto", "restriccion")
CONDICIONES = frozenset({
    "categorias_alguna", "nombre_alguno", "nombre_todos", "sin_alergenos",
    "con_alergenos",
})


@dataclass(frozen=True)
class Regla:
    categorias_alguna: Tuple[str, ...] = ()
    nombre_alguno: Tuple[str, ...] = ()
    nombre_todos: Tuple[str, ...] = ()
    sin_alergenos: FrozenSet[AllergenCode] = field(default_factory=frozenset)
    con_alergenos: FrozenSet[AllergenCode] = field(default_factory=frozenset)

    def es_relevante(
        self, producto: Producto, payload: Optional[Mapping[str, Any]]
    ) -> bool:
        if self.categorias_alguna:
            categorias = (payload or {}).get("categories_tags") or []
            if not set(self.categorias_alguna) & set(categorias):
                return False
        nombre = f" {normalizar(producto.nombre)} "
        if self.nombre_alguno and not any(
            f" {normalizar(f)} " in nombre for f in self.nombre_alguno
        ):
            return False
        if not all(f" {normalizar(f)} " in nombre for f in self.nombre_todos):
            return False
        presentes = set(producto.alergenos) | set(producto.trazas)
        if self.sin_alergenos & presentes:
            return False
        return self.con_alergenos <= set(producto.alergenos)


@dataclass(frozen=True)
class ConsultaEvaluacion:
    id: str
    consulta: str
    # "producto" ("galletas de avena") o "restriccion" ("galletas sin
    # gluten"): se promedian por separado.
    tipo: str
    regla: Regla
    nota: str = ""


@dataclass(frozen=True)
class ConjuntoEvaluacion:
    version: int
    consultas: Tuple[ConsultaEvaluacion, ...]


def cargar_conjunto(ruta: Path = RUTA_CONSULTAS) -> ConjuntoEvaluacion:
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    return conjunto_desde_dict(datos)


def conjunto_desde_dict(datos: Mapping[str, Any]) -> ConjuntoEvaluacion:
    """Valida el conjunto: un error aquí es un error del archivo, mejor
    detectarlo al cargar que evaluar con una regla mal escrita."""
    consultas = [_consulta(c) for c in datos["consultas"]]
    ids = [c.id for c in consultas]
    repetidos = sorted({i for i in ids if ids.count(i) > 1})
    if repetidos:
        raise ValueError(f"ids de consulta repetidos: {repetidos}")
    return ConjuntoEvaluacion(version=int(datos["version"]),
                              consultas=tuple(consultas))


def _consulta(datos: Mapping[str, Any]) -> ConsultaEvaluacion:
    identificador = datos.get("id", "?")
    if datos.get("tipo") not in TIPOS:
        raise ValueError(f"{identificador}: tipo debe ser uno de {TIPOS}")
    if not str(datos.get("consulta", "")).strip():
        raise ValueError(f"{identificador}: falta la consulta")
    condiciones = datos.get("relevancia") or {}
    desconocidas = set(condiciones) - CONDICIONES
    if desconocidas:
        raise ValueError(f"{identificador}: condiciones desconocidas "
                         f"{sorted(desconocidas)}")
    if not condiciones:
        raise ValueError(f"{identificador}: la relevancia no tiene "
                         "condiciones")
    return ConsultaEvaluacion(
        id=identificador,
        consulta=datos["consulta"],
        tipo=datos["tipo"],
        regla=Regla(
            categorias_alguna=tuple(condiciones.get("categorias_alguna", ())),
            nombre_alguno=tuple(condiciones.get("nombre_alguno", ())),
            nombre_todos=tuple(condiciones.get("nombre_todos", ())),
            sin_alergenos=_alergenos(condiciones.get("sin_alergenos", ())),
            con_alergenos=_alergenos(condiciones.get("con_alergenos", ())),
        ),
        nota=datos.get("nota", ""),
    )


def _alergenos(codigos: Sequence[str]) -> FrozenSet[AllergenCode]:
    # AllergenCode("xyz") falla con ValueError: un código mal escrito no
    # pasa en silencio.
    return frozenset(AllergenCode(c) for c in codigos)


def relevantes(
    regla: Regla,
    registros: Sequence[Tuple[Producto, Optional[Mapping[str, Any]]]],
) -> List[str]:
    """Códigos de los productos relevantes, entre los registros dados."""
    return [p.codigo_barras for p, payload in registros
            if regla.es_relevante(p, payload)]
