"""Convierte productos de la caché en documentos para el índice."""
from typing import Any, Iterable, List, Mapping, Optional, Tuple

from app.busqueda.indice import Documento
from app.schemas.producto import Producto


def categorias_del_payload(payload: Optional[Mapping[str, Any]]) -> List[str]:
    """Categorías del payload crudo de OFF, si vienen.

    El Producto del contrato no tiene categorías. Se usan "categories" (texto
    en el idioma del producto, como "Snacks, Galletas") y "categories_tags"
    ("en:biscuits" -> "biscuits"), que sirve para consultas en inglés.
    """
    if not payload:
        return []
    categorias: List[str] = []
    texto = payload.get("categories")
    if isinstance(texto, str):
        categorias += [c.strip() for c in texto.split(",") if c.strip()]
    etiquetas = payload.get("categories_tags")
    if isinstance(etiquetas, list):
        categorias += [
            e.split(":", 1)[-1].replace("-", " ")
            for e in etiquetas if isinstance(e, str)
        ]
    return list(dict.fromkeys(categorias))


def documento_de_producto(
    producto: Producto, payload: Optional[Mapping[str, Any]] = None
) -> Documento:
    return Documento(
        id=producto.codigo_barras,
        campos={
            "nombre": producto.nombre,
            "marca": producto.marca or "",
            "ingredientes": ", ".join(producto.ingredientes),
            "categorias": ", ".join(categorias_del_payload(payload)),
        },
    )


def documentos_indexables(
    registros: Iterable[Tuple[Producto, Optional[Mapping[str, Any]]]],
) -> List[Documento]:
    """Solo se indexan productos válidos: un registro sin ingredientes o
    con código inválido no debe aparecer en los resultados."""
    return [
        documento_de_producto(producto, payload)
        for producto, payload in registros
        if producto.calidad.es_valido
    ]
