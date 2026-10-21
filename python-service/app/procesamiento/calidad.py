"""Reglas de calidad de un producto: validez, completitud y duplicados."""
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

from app.procesamiento.texto import normalizar
from app.schemas.producto import Calidad, Producto

SIN_NOMBRE = "sin_nombre"
SIN_INGREDIENTES = "sin_ingredientes"
# Había texto, pero tras la limpieza no quedó ningún ingrediente.
INGREDIENTES_VACIOS = "ingredientes_vacios"
CODIGO_LONGITUD_INVALIDA = "codigo_barras_longitud_invalida"
CODIGO_DIGITO_INVALIDO = "codigo_barras_digito_verificador_invalido"
POSIBLE_DUPLICADO = "posible_duplicado"

# Problemas que hacen inválido el registro; el resto solo informa.
INVALIDANTES = frozenset({
    SIN_NOMBRE, SIN_INGREDIENTES, INGREDIENTES_VACIOS,
    CODIGO_LONGITUD_INVALIDA, CODIGO_DIGITO_INVALIDO,
})

# EAN-8, UPC-A y EAN-13.
LONGITUDES_CODIGO = (8, 12, 13)


def digito_verificador_valido(codigo: str) -> bool:
    """Dígito verificador GS1 (módulo 10, pesos 3 y 1 desde la derecha)."""
    if not codigo.isdigit() or len(codigo) not in LONGITUDES_CODIGO:
        return False
    *cuerpo, verificador = (int(d) for d in codigo)
    suma = sum(d * (3 if i % 2 == 0 else 1)
               for i, d in enumerate(reversed(cuerpo)))
    return (10 - suma % 10) % 10 == verificador


def problemas_codigo_barras(codigo: str) -> List[str]:
    if len(codigo) not in LONGITUDES_CODIGO:
        return [CODIGO_LONGITUD_INVALIDA]
    if not digito_verificador_valido(codigo):
        return [CODIGO_DIGITO_INVALIDO]
    return []


def evaluar_calidad(
    *,
    codigo_barras: str,
    nombre: Optional[str],
    marca: Optional[str],
    cantidad: Optional[str],
    ingredientes_texto: Optional[str],
    ingredientes: Sequence[str],
    nutriscore: Optional[str],
    imagen_url: Any,
    otros_problemas: Iterable[str] = (),
) -> Calidad:
    """Aplica las reglas de validez y calcula la completitud.

    `otros_problemas` son informativos (alérgenos detectados en el texto,
    etiquetas no reconocidas, ...) y no afectan la validez.
    """
    problemas: List[str] = []
    if nombre is None:
        problemas.append(SIN_NOMBRE)
    if marca is None:
        problemas.append("sin_marca")
    if cantidad is None:
        problemas.append("sin_cantidad")
    if ingredientes_texto is None:
        problemas.append(SIN_INGREDIENTES)
    elif not ingredientes:
        problemas.append(INGREDIENTES_VACIOS)
    if nutriscore is None:
        problemas.append("sin_nutriscore")
    if imagen_url is None:
        problemas.append("sin_imagen")
    problemas += problemas_codigo_barras(codigo_barras)
    problemas += otros_problemas

    # Campos relevantes para el usuario; los ingredientes cuentan solo si
    # quedó alguno después de limpiar.
    relevantes = (nombre, marca, cantidad, ingredientes or None, nutriscore,
                  imagen_url)
    presentes = sum(valor is not None for valor in relevantes)
    return Calidad(
        es_valido=not INVALIDANTES.intersection(problemas),
        problemas=problemas,
        completitud=round(presentes / len(relevantes), 2),
    )


def clave_duplicado(producto: Producto) -> Optional[str]:
    """Nombre, marca y cantidad normalizados; None si falta alguno."""
    if (SIN_NOMBRE in producto.calidad.problemas or not producto.marca
            or not producto.cantidad):
        return None
    cantidad = normalizar(producto.cantidad).replace(" ", "")  # "1 L"="1l"
    return "|".join(
        (normalizar(producto.nombre), normalizar(producto.marca), cantidad)
    )


def con_duplicados(producto: Producto, codigos: Iterable[str]) -> Producto:
    """Agrega "posible_duplicado:<código>" por cada otro código.

    Reemplaza las marcas anteriores, así se puede aplicar varias veces.
    """
    prefijo = f"{POSIBLE_DUPLICADO}:"
    problemas = [p for p in producto.calidad.problemas
                 if not p.startswith(prefijo)]
    problemas += [f"{prefijo}{c}" for c in sorted(set(codigos))
                  if c != producto.codigo_barras]
    if problemas == producto.calidad.problemas:
        return producto
    calidad = producto.calidad.model_copy(update={"problemas": problemas})
    return producto.model_copy(update={"calidad": calidad})


def marcar_duplicados(productos: Sequence[Producto]) -> List[Producto]:
    """Marca los productos con la misma clave y distinto código de barras.

    No descarta ninguno: puede ser el mismo producto con dos códigos o dos
    productos distintos que OFF describe igual.
    """
    grupos: Dict[str, List[str]] = defaultdict(list)
    claves = [clave_duplicado(p) for p in productos]
    for producto, clave in zip(productos, claves):
        if clave is not None:
            grupos[clave].append(producto.codigo_barras)
    return [
        con_duplicados(producto, grupos[clave] if clave else ())
        for producto, clave in zip(productos, claves)
    ]
