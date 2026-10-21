"""Reprocesa la caché desde el payload crudo de OFF, sin consultar la API.

Se usa al iniciar el servicio (solo los productos procesados con una
VERSION_PROCESAMIENTO anterior) y desde scripts/reprocesar_cache.py.
"""
import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import Counter as CounterType

from pydantic import ValidationError

from app.procesamiento import VERSION_PROCESAMIENTO
from app.procesamiento.calidad import INVALIDANTES, POSIBLE_DUPLICADO
from app.repositories.cache import RepositorioCache
from app.services.mapeo_off import ProductoInvalido, mapear_producto

logger = logging.getLogger(__name__)


@dataclass
class ResumenReprocesamiento:
    total: int = 0
    reprocesados: int = 0
    errores: int = 0
    validos: int = 0
    invalidos: int = 0
    # Código de alérgeno -> productos donde solo se detectó en el texto.
    alergenos_en_texto: CounterType[str] = field(default_factory=Counter)
    trazas_en_texto: CounterType[str] = field(default_factory=Counter)
    alergenos_posibles: CounterType[str] = field(default_factory=Counter)
    # Problemas de los inválidos, para saber por qué lo son.
    motivos_invalidez: CounterType[str] = field(default_factory=Counter)
    posibles_duplicados: int = 0


def reprocesar_cache(
    repositorio: RepositorioCache,
    base_url: str,
    *,
    todos: bool = False,
    version: int = VERSION_PROCESAMIENTO,
) -> ResumenReprocesamiento:
    """Vuelve a mapear los productos desactualizados (o todos).

    Conserva run_id y recuperado_en: los datos siguen siendo los de esa
    descarga, solo cambió cómo se procesan.
    """
    resumen = ResumenReprocesamiento()
    pendientes = repositorio.listar_para_reprocesar(
        None if todos else version
    )
    for registro in pendientes:
        anterior = registro.producto
        try:
            producto = mapear_producto(
                registro.payload_off,
                run_id=anterior.procedencia.run_id,
                recuperado_en=anterior.procedencia.recuperado_en,
                base_url=base_url,
            )
        except (ProductoInvalido, ValidationError) as exc:
            # Se deja como estaba; se reintentará en el próximo arranque.
            resumen.errores += 1
            logger.warning("No se pudo reprocesar %s: %s",
                           anterior.codigo_barras, exc)
            continue
        repositorio.actualizar_procesamiento(producto, version)
        resumen.reprocesados += 1

    for producto in repositorio.listar_productos():
        resumen.total += 1
        problemas = producto.calidad.problemas
        if producto.calidad.es_valido:
            resumen.validos += 1
        else:
            resumen.invalidos += 1
        for problema in problemas:
            tipo, _, valor = problema.partition(":")
            if tipo == "alergeno_detectado_en_texto":
                resumen.alergenos_en_texto[valor] += 1
            elif tipo == "traza_detectada_en_texto":
                resumen.trazas_en_texto[valor] += 1
            elif tipo == "alergeno_posible":
                resumen.alergenos_posibles[valor] += 1
            elif tipo in INVALIDANTES:
                resumen.motivos_invalidez[tipo] += 1
        if any(p.startswith(f"{POSIBLE_DUPLICADO}:") for p in problemas):
            resumen.posibles_duplicados += 1
    return resumen
