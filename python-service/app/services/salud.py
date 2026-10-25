"""GET /health: estado del servicio y de sus dependencias.

- cache: abre la base SQLite y cuenta los productos.
- indice: ok si está cargado y tiene productos; degradado si está vacío;
  error si todavía no se construyó.
- openfoodfacts: no se consulta la API (gastaría el límite de tasa); se
  deduce de la última ingesta terminada y de la última falla registrada.

Estado global: error si la caché no responde; si no, degradado si alguna
dependencia no está ok (no_verificado no cuenta como falla); si no, ok.
Las funciones de decisión son puras para poder probar cada combinación.
"""
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from app.core.logs import SERVICIO
from app.repositories.cache import RepositorioCache
from app.schemas.ingesta import ResumenIngesta
from app.schemas.sistema import (
    DetalleCache,
    DetalleIndice,
    DetalleOpenFoodFacts,
    DetalleSalud,
    RespuestaSalud,
)
from app.services.busqueda import ServicioBusqueda

logger = logging.getLogger(__name__)

# Una falla de la fuente posterior a la última ingesta terminada deja a
# openfoodfacts degradado durante este tiempo.
VENTANA_FALLA_RECIENTE = timedelta(minutes=15)


def estado_indice(cargado: bool, productos: int) -> str:
    if not cargado:
        return "error"
    return "ok" if productos > 0 else "degradado"


def estado_openfoodfacts(
    ultima: Optional[ResumenIngesta],
    ultima_falla: Optional[datetime],
    ahora: datetime,
) -> str:
    # Las fallas de una ingesta que igual terminó bien (recuperadas en su
    # reintento) son anteriores a su fin y no cuentan.
    falla_reciente = (
        ultima_falla is not None
        and ahora - ultima_falla <= VENTANA_FALLA_RECIENTE
        and (ultima is None or ultima_falla > ultima.fin)
    )
    if falla_reciente:
        return "degradado"
    if ultima is None:
        return "no_verificado"
    return "ok" if ultima.estado == "completado" else "degradado"


def estado_global(dependencias: Dict[str, str]) -> str:
    if dependencias["cache"] == "error":
        return "error"
    if all(e in ("ok", "no_verificado") for e in dependencias.values()):
        return "ok"
    return "degradado"


def evaluar_salud(
    repositorio: RepositorioCache,
    busqueda: ServicioBusqueda,
    version: str,
    ahora: Optional[datetime] = None,
) -> RespuestaSalud:
    """Síncrona (lee SQLite): desde el endpoint se llama en un hilo."""
    ahora = ahora or datetime.now(timezone.utc)
    instantanea = busqueda.instantanea  # se lee una sola vez
    indice = DetalleIndice(cargado=busqueda.cargado,
                           productos=len(instantanea.productos))
    cache = DetalleCache()
    fuente = DetalleOpenFoodFacts()
    try:
        cache.productos = repositorio.verificar()
    except (sqlite3.Error, OSError) as exc:
        logger.error("La caché no responde: %s", exc,
                     extra={"evento": "salud", "dependencia": "cache"})
        # Sin caché no se puede leer el estado de las ingestas.
        estado_fuente = "no_verificado"
        estado_cache = "error"
    else:
        estado_cache = "ok"
        # Las de la semilla no dicen nada de la fuente vista desde aquí.
        ultima = repositorio.ultima_ejecucion_terminada(excluir_semilla=True)
        fallas = repositorio.listar_errores_fuente(limite=1,
                                                   excluir_semilla=True)
        if ultima is not None:
            fuente.ultima_ingesta = ultima.estado
            fuente.ultima_ingesta_fin = ultima.fin
        if fallas:
            fuente.ultima_falla = fallas[0].fecha
        estado_fuente = estado_openfoodfacts(ultima, fuente.ultima_falla,
                                             ahora)
    dependencias = {
        "cache": estado_cache,
        "indice": estado_indice(indice.cargado, indice.productos),
        "openfoodfacts": estado_fuente,
    }
    return RespuestaSalud(
        estado=estado_global(dependencias),
        # El mismo nombre que el campo service de los logs.
        servicio=SERVICIO,
        version=version,
        verificado_en=ahora,
        dependencias=dependencias,
        detalle=DetalleSalud(cache=cache, indice=indice,
                             openfoodfacts=fuente),
    )
