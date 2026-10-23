"""Semilla del corpus: los productos válidos de la caché en un archivo.

En Render (plan gratuito) el disco es efímero y la caché SQLite se pierde
en cada reinicio o despliegue. Con la semilla, el servicio arranca con
datos sin llamar a Open Food Facts: si la caché está vacía, se cargan los
payloads crudos y se procesan con la VERSION_PROCESAMIENTO actual. La
ingesta periódica los actualiza después como siempre.

Los datos vienen de Open Food Facts (ODbL); ver semilla/ATRIBUCION.md.
"""
import gzip
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import ValidationError

from app.procesamiento import VERSION_PROCESAMIENTO
from app.repositories.cache import RepositorioCache
from app.services.mapeo_off import ProductoInvalido, mapear_producto

logger = logging.getLogger(__name__)

RUTA_SEMILLA = (Path(__file__).resolve().parents[2]
                / "semilla" / "corpus-off.json.gz")
FORMATO_SEMILLA = 1
ATRIBUCION = {
    "fuente": "Open Food Facts (https://world.openfoodfacts.org)",
    "licencia": "Open Database License (ODbL) v1.0 "
                "(https://opendatacommons.org/licenses/odbl/1-0/)",
    "contenidos": "Database Contents License (DbCL) v1.0 "
                  "(https://opendatacommons.org/licenses/dbcl/1-0/)",
}


class SemillaInvalida(ValueError):
    """El archivo no tiene el formato esperado."""


@dataclass(frozen=True)
class ResumenSemilla:
    total: int = 0
    cargados: int = 0
    errores: int = 0


def exportar_semilla(repositorio: RepositorioCache, ruta: Path) -> int:
    """Escribe los productos válidos con su payload crudo, procedencia y
    versión de procesamiento. Devuelve cuántos exportó.

    El orden es por código de barras y el gzip no guarda fecha, así que dos
    exportaciones del mismo corpus solo difieren en `exportado_en`.
    """
    productos = [
        {
            "payload_off": registro.payload_off,
            "procedencia": registro.producto.procedencia.model_dump(
                mode="json"),
            "verificado_en": _a_texto(registro.verificado_en),
            "version_procesamiento": registro.version_procesamiento,
        }
        for registro in repositorio.listar_para_reprocesar()
        if registro.producto.calidad.es_valido
    ]
    contenido = {
        "formato": FORMATO_SEMILLA,
        **ATRIBUCION,
        "exportado_en": _a_texto(datetime.now(timezone.utc)),
        "version_procesamiento": VERSION_PROCESAMIENTO,
        "productos": productos,
    }
    ruta.parent.mkdir(parents=True, exist_ok=True)
    datos = json.dumps(contenido, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")).encode("utf-8")
    ruta.write_bytes(gzip.compress(datos, compresslevel=9, mtime=0))
    return len(productos)


def leer_semilla(ruta: Path) -> Dict[str, Any]:
    try:
        contenido = json.loads(gzip.decompress(ruta.read_bytes()))
    except (OSError, EOFError, ValueError) as exc:
        raise SemillaInvalida(f"No se pudo leer {ruta}: {exc}") from exc
    if (not isinstance(contenido, dict)
            or contenido.get("formato") != FORMATO_SEMILLA
            or not isinstance(contenido.get("productos"), list)):
        raise SemillaInvalida(
            f"{ruta} no tiene el formato {FORMATO_SEMILLA} de la semilla"
        )
    return contenido


def cargar_semilla(
    repositorio: RepositorioCache,
    base_url: str,
    ruta: Optional[Path] = None,
) -> ResumenSemilla:
    """Procesa cada payload con las reglas actuales y lo guarda.

    Conserva run_id, recuperado_en y verificado_en: los datos siguen
    siendo los de esa descarga, solo cambió cómo se procesan (igual que el
    reprocesamiento).
    """
    productos = leer_semilla(ruta or RUTA_SEMILLA)["productos"]
    cargados = errores = 0
    for registro in productos:
        try:
            procedencia = registro["procedencia"]
            producto = mapear_producto(
                registro["payload_off"],
                run_id=UUID(procedencia["run_id"]),
                recuperado_en=_desde_texto(procedencia["recuperado_en"]),
                base_url=base_url,
            )
            verificado_en = (_desde_texto(registro["verificado_en"])
                             if registro.get("verificado_en") else None)
        except (KeyError, TypeError, ValueError, ProductoInvalido,
                ValidationError) as exc:
            errores += 1
            logger.warning("Producto de la semilla omitido: %s", exc)
            continue
        repositorio.guardar_producto(producto, registro["payload_off"],
                                     verificado_en=verificado_en)
        cargados += 1
    return ResumenSemilla(len(productos), cargados, errores)


def cargar_semilla_si_vacia(
    repositorio: RepositorioCache,
    base_url: str,
    ruta: Optional[Path] = None,
) -> Optional[ResumenSemilla]:
    """Carga la semilla solo si la caché no tiene productos. Devuelve None
    si no hizo nada; un archivo ausente o dañado no impide arrancar."""
    if repositorio.contar_productos() > 0:
        return None
    ruta = ruta or RUTA_SEMILLA
    if not ruta.exists():
        logger.warning("Caché vacía y sin semilla en %s", ruta)
        return None
    try:
        resumen = cargar_semilla(repositorio, base_url, ruta)
    except SemillaInvalida as exc:
        logger.error("No se cargó la semilla: %s", exc)
        return None
    logger.info("Semilla cargada en la caché vacía: %d de %d productos "
                "(%d omitidos)", resumen.cargados, resumen.total,
                resumen.errores)
    return resumen


def _a_texto(fecha: Optional[datetime]) -> Optional[str]:
    if fecha is None:
        return None
    return fecha.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _desde_texto(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))
