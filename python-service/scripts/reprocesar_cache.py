"""Reprocesa la caché SQLite desde el payload crudo de Open Food Facts.

No consulta la API: vuelve a limpiar ingredientes, detectar alérgenos y
validar cada producto con las reglas actuales, y muestra un resumen.

Uso, desde python-service/:
    python scripts/reprocesar_cache.py            # solo versiones anteriores
    python scripts/reprocesar_cache.py --todos    # todos los productos
    python scripts/reprocesar_cache.py --db data/otra.sqlite3

Con Docker Compose, sobre la caché del volumen (agrega --todos si hace
falta):
    docker compose exec python-service python scripts/reprocesar_cache.py
"""
import argparse
import logging
import sys
from pathlib import Path
from typing import Counter

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.core.config import settings  # noqa: E402
from app.procesamiento import VERSION_PROCESAMIENTO  # noqa: E402
from app.repositories.cache import RepositorioCache  # noqa: E402
from app.services.reprocesamiento import (  # noqa: E402
    ResumenReprocesamiento,
    reprocesar_cache,
)


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=settings.cache_db_path,
                        help="Base SQLite (por defecto CACHE_DB_PATH).")
    parser.add_argument("--todos", action="store_true",
                        help="Reprocesa también los que ya están al día.")
    return parser.parse_args(argv)


def _conteo(titulo: str, conteo: Counter) -> str:
    if not conteo:
        return f"{titulo}: ninguno"
    detalle = ", ".join(f"{clave} {n}" for clave, n in conteo.most_common())
    return f"{titulo}: {detalle}"


def formatear(resumen: ResumenReprocesamiento) -> str:
    return "\n".join([
        f"Versión de procesamiento: {VERSION_PROCESAMIENTO}",
        f"Productos en caché: {resumen.total}",
        f"Reprocesados: {resumen.reprocesados} (errores: {resumen.errores})",
        f"Válidos: {resumen.validos}",
        f"Inválidos: {resumen.invalidos}",
        _conteo("  Motivos", resumen.motivos_invalidez),
        _conteo("Alérgenos detectados solo en el texto",
                resumen.alergenos_en_texto),
        _conteo("Trazas detectadas solo en el texto",
                resumen.trazas_en_texto),
        _conteo("Alérgenos posibles", resumen.alergenos_posibles),
        f"Productos con posibles duplicados: "
        f"{resumen.posibles_duplicados}",
    ])


def main(argv=None) -> int:
    args = leer_argumentos(argv)
    if not Path(args.db).exists():
        print(f"ERROR: no existe la caché {args.db}", file=sys.stderr)
        return 2
    repositorio = RepositorioCache(args.db)
    repositorio.inicializar()  # agrega columnas nuevas si es una base antigua
    resumen = reprocesar_cache(repositorio, settings.off_base_url,
                               todos=args.todos)
    print(formatear(resumen))
    return 1 if resumen.errores else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    sys.exit(main())
