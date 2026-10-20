"""Catálogo de ejemplo leído de fixtures; se reemplazará por PostgreSQL."""
import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Tuple

from app.schemas.busqueda import ResultadoBusqueda
from app.schemas.producto import Producto

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@lru_cache
def cargar_productos() -> Tuple[Producto, ...]:
    ruta = _FIXTURES / "productos.json"
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    return tuple(Producto.model_validate(p) for p in datos)


def obtener_producto(codigo_barras: str) -> Optional[Producto]:
    for producto in cargar_productos():
        if producto.codigo_barras == codigo_barras:
            return producto
    return None


def _tokens(texto: str) -> List[str]:
    sin_tildes = unicodedata.normalize("NFKD", texto.lower())
    sin_tildes = "".join(c for c in sin_tildes if not unicodedata.combining(c))
    return "".join(c if c.isalnum() else " " for c in sin_tildes).split()


def buscar(
    consulta: str, limit: int, offset: int
) -> Tuple[int, List[ResultadoBusqueda]]:
    """Ranking provisional: cantidad de tokens de la consulta presentes."""
    terminos = set(_tokens(consulta))
    puntuados = []
    for producto in cargar_productos():
        texto = " ".join(
            [producto.nombre, producto.marca or "", *producto.ingredientes]
        )
        score = float(len(terminos & set(_tokens(texto))))
        if score > 0:
            puntuados.append((score, producto))
    puntuados.sort(key=lambda par: (-par[0], par[1].nombre))
    pagina = puntuados[offset:offset + limit]
    resultados = [
        ResultadoBusqueda(producto=p, score=s, posicion=offset + i + 1)
        for i, (s, p) in enumerate(pagina)
    ]
    return len(puntuados), resultados
