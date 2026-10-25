"""Semilla del corpus: los productos válidos de la caché en un archivo.

En Render (plan gratuito) el disco es efímero y la caché SQLite se pierde
en cada reinicio o despliegue. Con la semilla, el servicio arranca con
datos sin llamar a Open Food Facts: si la caché está vacía, se cargan los
payloads crudos y se procesan con la VERSION_PROCESAMIENTO actual. La
ingesta periódica los actualiza después como siempre.

La semilla también guarda los resúmenes de las ingestas reales que
produjeron el corpus (conteos, detalle y fallas de la fuente). Se importan
con origen "semilla" para que /metrics/quality e /ingest/runs/latest
muestren los valores del corpus y no ceros, sin confundirlas con ingestas
hechas por el propio servicio.

Los datos vienen de Open Food Facts (ODbL); ver semilla/ATRIBUCION.md.
"""
import gzip
import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from pydantic import ValidationError

from app.procesamiento import VERSION_PROCESAMIENTO
from app.repositories.cache import (
    DetalleIngesta,
    ErrorFuente,
    RepositorioCache,
)
from app.schemas.ingesta import ResumenIngesta
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
    # Ejecuciones de ingesta importadas y omitidas (ya existían o no se
    # pudieron leer).
    ejecuciones: int = 0
    ejecuciones_omitidas: int = 0


def exportar_semilla(repositorio: RepositorioCache, ruta: Path) -> int:
    """Escribe los productos válidos con su payload crudo, procedencia y
    versión de procesamiento, y las ejecuciones de ingesta terminadas con
    su detalle y sus fallas. Devuelve cuántos productos exportó.

    El orden es fijo (productos por código de barras, ejecuciones por
    inicio) y el gzip no guarda fecha, así que dos exportaciones del mismo
    corpus solo difieren en `exportado_en`.
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
        "ejecuciones": _exportar_ejecuciones(repositorio),
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
    # "ejecuciones" es opcional: las semillas anteriores no la tienen.
    if (not isinstance(contenido, dict)
            or contenido.get("formato") != FORMATO_SEMILLA
            or not isinstance(contenido.get("productos"), list)
            or not isinstance(contenido.get("ejecuciones", []), list)):
        raise SemillaInvalida(
            f"{ruta} no tiene el formato {FORMATO_SEMILLA} de la semilla"
        )
    return contenido


def cargar_semilla(
    repositorio: RepositorioCache,
    base_url: str,
    ruta: Optional[Path] = None,
) -> ResumenSemilla:
    """Procesa cada payload con las reglas actuales y lo guarda, e importa
    las ejecuciones de ingesta con origen "semilla".

    Conserva run_id, recuperado_en y verificado_en: los datos siguen
    siendo los de esa descarga, solo cambió cómo se procesan (igual que el
    reprocesamiento).
    """
    contenido = leer_semilla(ruta or RUTA_SEMILLA)
    productos = contenido["productos"]
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
    importadas, omitidas = _importar_ejecuciones(
        repositorio, contenido.get("ejecuciones", [])
    )
    return ResumenSemilla(len(productos), cargados, errores,
                          importadas, omitidas)


def _exportar_ejecuciones(
    repositorio: RepositorioCache,
) -> List[Dict[str, Any]]:
    """Las ejecuciones terminadas, tal como están en la caché, sin el
    origen: al importarlas siempre quedan como "semilla"."""
    ejecuciones = []
    for ejecucion in repositorio.listar_ejecuciones_terminadas():
        resumen = ejecucion.resumen.model_dump(mode="json",
                                               exclude={"origen"})
        resumen["inicio"] = _a_texto(ejecucion.resumen.inicio)
        resumen["fin"] = _a_texto(ejecucion.resumen.fin)
        fallas = repositorio.listar_errores_fuente(
            run_id=ejecucion.resumen.run_id, limite=None
        )
        ejecuciones.append({
            "resumen": resumen,
            "detalle": (asdict(ejecucion.detalle)
                        if ejecucion.detalle is not None else None),
            "fallas": [
                {"fecha": _a_texto(f.fecha), "tipo": f.tipo,
                 "mensaje": f.mensaje}
                for f in reversed(fallas)  # de la más antigua a la última
            ],
        })
    return ejecuciones


def _importar_ejecuciones(
    repositorio: RepositorioCache, ejecuciones: List[Any]
) -> Tuple[int, int]:
    """Devuelve (importadas, omitidas)."""
    importadas = omitidas = 0
    for registro in ejecuciones:
        try:
            resumen = ResumenIngesta.model_validate(
                {**registro["resumen"], "origen": "semilla"}
            )
            detalle = (_leer_detalle(registro["detalle"])
                       if registro.get("detalle") is not None else None)
            fallas = [
                ErrorFuente(fecha=_desde_texto(f["fecha"]),
                            run_id=resumen.run_id, tipo=str(f["tipo"]),
                            mensaje=str(f["mensaje"]))
                for f in registro.get("fallas", [])
            ]
            importada = repositorio.importar_ejecucion(resumen, detalle,
                                                       fallas)
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            omitidas += 1
            logger.warning("Ejecución de la semilla omitida: %s", exc)
            continue
        if importada:
            importadas += 1
        else:
            omitidas += 1
            logger.warning("Ejecución de la semilla omitida: %s ya existe",
                           resumen.run_id)
    return importadas, omitidas


def _leer_detalle(datos: Dict[str, Any]) -> DetalleIngesta:
    motivos = datos.get("motivos_invalidez", {})
    if not isinstance(motivos, dict):
        raise TypeError("motivos_invalidez debe ser un objeto")
    return DetalleIngesta(
        repetidos_en_ejecucion=int(datos["repetidos_en_ejecucion"]),
        existentes_sin_cambios=int(datos["existentes_sin_cambios"]),
        con_ingredientes=int(datos["con_ingredientes"]),
        peticiones=int(datos["peticiones"]),
        fallas_recuperadas=int(datos["fallas_recuperadas"]),
        motivos_invalidez={str(k): int(v) for k, v in motivos.items()},
    )


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
                "(%d omitidos) y %d ejecuciones de ingesta (%d omitidas)",
                resumen.cargados, resumen.total, resumen.errores,
                resumen.ejecuciones, resumen.ejecuciones_omitidas)
    return resumen


def _a_texto(fecha: Optional[datetime]) -> Optional[str]:
    if fecha is None:
        return None
    return fecha.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _desde_texto(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))
