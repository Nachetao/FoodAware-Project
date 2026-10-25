"""Exporta el corpus de la caché a la semilla comprimida del servicio.

Guarda los productos válidos con su payload crudo de Open Food Facts, su
procedencia y su versión de procesamiento, y las ejecuciones de ingesta
terminadas (conteos, detalle y fallas), en semilla/corpus-off.json.gz.
Con la caché vacía, el servicio la carga al iniciar (ver
app/services/semilla.py). No consulta la API.

Uso, desde python-service/:
    python scripts/exportar_semilla.py
    python scripts/exportar_semilla.py --db data/otra.sqlite3 --salida x.gz

Con Docker Compose, sobre la caché del volumen (el código de la imagen es
de solo lectura, así que se escribe en /tmp y se copia):
    docker compose exec python-service python scripts/exportar_semilla.py \\
        --salida /tmp/corpus-off.json.gz
    docker compose cp python-service:/tmp/corpus-off.json.gz \\
        python-service/semilla/corpus-off.json.gz
"""
import argparse
import sys
from pathlib import Path

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.core.config import settings  # noqa: E402
from app.repositories.cache import RepositorioCache  # noqa: E402
from app.services.semilla import RUTA_SEMILLA, exportar_semilla  # noqa: E402


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=settings.cache_db_path,
                        help="Base SQLite (por defecto CACHE_DB_PATH).")
    parser.add_argument("--salida", type=Path, default=RUTA_SEMILLA,
                        help=f"Archivo de semilla (por defecto "
                             f"{RUTA_SEMILLA.relative_to(RAIZ_SERVICIO)}).")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = leer_argumentos(argv)
    if not Path(args.db).exists():
        print(f"ERROR: no existe la caché {args.db}", file=sys.stderr)
        return 2
    repositorio = RepositorioCache(args.db)
    repositorio.inicializar()  # agrega columnas nuevas si es una base antigua
    total = repositorio.contar_productos()
    exportados = exportar_semilla(repositorio, args.salida)
    if not exportados:
        print("ERROR: la caché no tiene productos válidos", file=sys.stderr)
        return 1
    tamano = args.salida.stat().st_size
    ejecuciones = len(repositorio.listar_ejecuciones_terminadas())
    print(f"Semilla: {exportados} productos válidos de {total} en caché")
    print(f"Ejecuciones de ingesta: {ejecuciones}")
    ultima = repositorio.ultima_ejecucion()
    if ultima is not None and ultima.estado == "en_curso":
        print("AVISO: hay una ingesta en curso; no quedó en la semilla",
              file=sys.stderr)
    print(f"Archivo: {args.salida} ({tamano / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
