"""Mapeo básico de un producto de Open Food Facts al esquema Producto.

La limpieza profunda de ingredientes queda para el Bloque 3; aquí solo se
traducen etiquetas, se elige el idioma y se evalúa la calidad mínima.
"""
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple, TypeVar
from uuid import UUID

from pydantic import HttpUrl, TypeAdapter, ValidationError

from app.schemas.enums import AllergenCode, DietLabel
from app.schemas.producto import Calidad, Procedencia, Producto

# IDs canónicos de la taxonomía de alérgenos de OFF (taxonomies/allergens.txt)
ALERGENOS_OFF: Dict[str, AllergenCode] = {
    "en:milk": AllergenCode.lacteos,
    "en:gluten": AllergenCode.gluten,
    "en:eggs": AllergenCode.huevo,
    "en:peanuts": AllergenCode.mani,
    "en:nuts": AllergenCode.frutos_secos,
    "en:soybeans": AllergenCode.soya,
    "en:fish": AllergenCode.pescado,
    "en:crustaceans": AllergenCode.crustaceos,
    "en:molluscs": AllergenCode.moluscos,
    "en:sesame-seeds": AllergenCode.sesamo,
    "en:mustard": AllergenCode.mostaza,
    "en:celery": AllergenCode.apio,
    "en:sulphur-dioxide-and-sulphites": AllergenCode.sulfitos,
    "en:lupin": AllergenCode.altramuces,
}

# IDs canónicos de taxonomies/labels.txt
ETIQUETAS_OFF: Dict[str, DietLabel] = {
    "en:vegan": DietLabel.vegano,
    "en:vegetarian": DietLabel.vegetariano,
    "en:no-gluten": DietLabel.sin_gluten,
    "en:no-lactose": DietLabel.sin_lactosa,
}

# Campo de Producto -> problema registrado en calidad si falta.
_PROBLEMA_SI_FALTA = {
    "nombre": "sin_nombre",
    "marca": "sin_marca",
    "cantidad": "sin_cantidad",
    "ingredientes_texto": "sin_ingredientes",
    "nutriscore": "sin_nutriscore",
    "imagen_url": "sin_imagen",
}
_CODIGO_VALIDO = re.compile(r"\d{8,14}")
_URL = TypeAdapter(HttpUrl)
_HASH_PROVISORIO = "0" * 64
T = TypeVar("T")


class ProductoInvalido(ValueError):
    """El payload no se puede representar como Producto (p. ej. sin código)."""


def mapear_producto(
    payload: Dict[str, Any],
    *,
    run_id: UUID,
    recuperado_en: datetime,
    base_url: str,
) -> Producto:
    codigo = str(payload.get("code") or "").strip()
    if not _CODIGO_VALIDO.fullmatch(codigo):
        raise ProductoInvalido(f"Código de barras inválido: {codigo!r}")

    alergenos, desconocidos = _traducir(
        payload.get("allergens_tags"), ALERGENOS_OFF
    )
    trazas, desconocidas = _traducir(payload.get("traces_tags"), ALERGENOS_OFF)
    etiquetas, _ = _traducir(payload.get("labels_tags"), ETIQUETAS_OFF)
    vegano = DietLabel.vegano in etiquetas
    if vegano and DietLabel.vegetariano not in etiquetas:
        etiquetas.append(DietLabel.vegetariano)

    campos = {
        "nombre": _texto(payload, "product_name_es", "product_name",
                         maximo=300),
        "marca": _texto(payload, "brands", maximo=200),
        "cantidad": _texto(payload, "quantity", maximo=50),
        "ingredientes_texto": _texto(
            payload, "ingredients_text_es", "ingredients_text", maximo=5000
        ),
        "nutriscore": _nutriscore(payload.get("nutriscore_grade")),
        "imagen_url": _url(payload.get("image_front_url"))
        or _url(payload.get("image_url")),
    }
    problemas = [p for c, p in _PROBLEMA_SI_FALTA.items() if campos[c] is None]
    if desconocidos or desconocidas:
        problemas.append("alergenos_no_reconocidos")
    presentes = sum(valor is not None for valor in campos.values())

    producto = Producto(
        codigo_barras=codigo,
        **{**campos, "nombre": campos["nombre"] or f"Producto {codigo}"},
        ingredientes=separar_ingredientes(campos["ingredientes_texto"]),
        alergenos=alergenos,
        trazas=trazas,
        etiquetas_dieta=etiquetas,
        procedencia=Procedencia(
            url_fuente=f"{base_url.rstrip('/')}/product/{codigo}",
            recuperado_en=recuperado_en,
            modificado_en_fuente=_desde_epoch(payload.get("last_modified_t")),
            run_id=run_id,
            hash_contenido=_HASH_PROVISORIO,
        ),
        calidad=Calidad(
            es_valido=campos["nombre"] is not None
            and campos["ingredientes_texto"] is not None,
            problemas=problemas,
            completitud=round(presentes / len(campos), 2),
        ),
    )
    procedencia = producto.procedencia.model_copy(
        update={"hash_contenido": hash_contenido(producto)}
    )
    return producto.model_copy(update={"procedencia": procedencia})


def hash_contenido(producto: Producto) -> str:
    """SHA-256 del contenido del producto, sin procedencia ni calidad."""
    datos = producto.model_dump(
        mode="json", exclude={"procedencia", "calidad"}
    )
    canonico = json.dumps(
        datos, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def separar_ingredientes(texto: Optional[str]) -> List[str]:
    """Separa por comas o punto y coma de primer nivel (respeta paréntesis).

    OFF marca los alérgenos con guiones bajos (_leche_); se quitan.
    """
    if not texto:
        return []
    partes, actual, profundidad = [], [], 0
    for caracter in texto.replace("_", ""):
        if caracter in "([":
            profundidad += 1
        elif caracter in ")]":
            profundidad = max(0, profundidad - 1)
        if caracter in ",;" and profundidad == 0:
            partes.append("".join(actual))
            actual = []
        else:
            actual.append(caracter)
    partes.append("".join(actual))
    limpias = (" ".join(p.split()).strip(" .").lower() for p in partes)
    return _sin_repetidos(p for p in limpias if p)


def _traducir(
    etiquetas: Any, tabla: Dict[str, T]
) -> Tuple[List[T], List[str]]:
    """Devuelve (traducidas sin repetir, etiquetas no reconocidas)."""
    if not isinstance(etiquetas, list):
        return [], []
    conocidas: List[T] = []
    desconocidas: List[str] = []
    for etiqueta in etiquetas:
        if etiqueta in tabla:
            conocidas.append(tabla[etiqueta])
        elif isinstance(etiqueta, str) and etiqueta != "en:none":
            desconocidas.append(etiqueta)
    return _sin_repetidos(conocidas), desconocidas


def _texto(payload: Dict[str, Any], *claves: str, maximo: int):
    for clave in claves:
        valor = payload.get(clave)
        if isinstance(valor, str) and valor.strip():
            return " ".join(valor.split())[:maximo]
    return None


def _nutriscore(valor: Any) -> Optional[str]:
    if isinstance(valor, str) and valor.lower() in ("a", "b", "c", "d", "e"):
        return valor.lower()
    return None


def _url(valor: Any) -> Optional[HttpUrl]:
    if not isinstance(valor, str) or not valor:
        return None
    try:
        return _URL.validate_python(valor)
    except ValidationError:
        return None


def _desde_epoch(valor: Any) -> Optional[datetime]:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    if valor <= 0:
        return None
    return datetime.fromtimestamp(valor, tz=timezone.utc)


def _sin_repetidos(valores: Iterable[T]) -> List[T]:
    return list(dict.fromkeys(valores))
