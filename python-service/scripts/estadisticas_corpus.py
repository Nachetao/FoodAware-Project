"""Resumen del corpus de búsqueda a partir de la caché SQLite.

No consulta Open Food Facts. Muestra los productos válidos (los que se
indexan), cuántos hay de cada categoría de INGESTA_CATEGORIAS, los términos
distintos del índice BM25 y el largo promedio de los documentos.

Uso, desde python-service/:
    python scripts/estadisticas_corpus.py
    python scripts/estadisticas_corpus.py --db data/otra.sqlite3
    python scripts/estadisticas_corpus.py --categorias en:biscuits,en:breads

Con Docker Compose, sobre la caché del volumen:
    docker compose exec python-service python scripts/estadisticas_corpus.py
"""
import argparse
import sys
from pathlib import Path

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.busqueda.estadisticas import (  # noqa: E402
    EstadisticasCorpus,
    calcular_estadisticas,
)
from app.core.config import settings  # noqa: E402
from app.repositories.cache import RepositorioCache  # noqa: E402

CATEGORIAS_FRECUENTES = 10


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=settings.cache_db_path,
                        help="Base SQLite (por defecto CACHE_DB_PATH).")
    parser.add_argument("--categorias", default=None,
                        help="Lista separada por comas (por defecto "
                             "INGESTA_CATEGORIAS).")
    return parser.parse_args(argv)


def formatear(resumen: EstadisticasCorpus) -> str:
    lineas = [
        f"Productos en caché: {resumen.total_productos}",
        f"Productos válidos (indexados): {resumen.validos}",
        "Productos por categoría:",
    ]
    lineas += [f"  {categoria}: {n}"
               for categoria, n in resumen.por_categoria.items()]
    lineas += [
        f"  sin categoría configurada: {resumen.sin_categoria_configurada}",
        "Categorías más frecuentes en OFF:",
    ]
    frecuentes = resumen.categorias_frecuentes.most_common(
        CATEGORIAS_FRECUENTES
    )
    lineas += [f"  {c}: {n}" for c, n in frecuentes] or ["  ninguna"]
    lineas += [
        f"Términos distintos en el índice: {resumen.terminos_distintos}",
        "Largo promedio (términos por producto): "
        f"{resumen.largo_promedio_total:.1f}",
    ]
    lineas += [f"  {campo}: {largo:.1f}"
               for campo, largo in resumen.largo_promedio.items()]
    return "\n".join(lineas)


def main(argv=None) -> int:
    args = leer_argumentos(argv)
    if not Path(args.db).exists():
        print(f"ERROR: no existe la caché {args.db}", file=sys.stderr)
        return 2
    categorias = (
        [c.strip() for c in args.categorias.split(",") if c.strip()]
        if args.categorias is not None else settings.ingesta_categorias
    )
    repositorio = RepositorioCache(args.db)
    repositorio.inicializar()  # agrega columnas nuevas si es una base antigua
    resumen = calcular_estadisticas(
        repositorio.listar_productos_con_payload(), categorias
    )
    print(formatear(resumen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
