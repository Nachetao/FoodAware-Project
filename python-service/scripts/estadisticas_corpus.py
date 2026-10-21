"""Resumen del corpus de búsqueda y de la calidad de los datos.

No consulta Open Food Facts; lee la caché SQLite. Muestra:
- El corpus: productos válidos (los que se indexan), cuántos hay de cada
  categoría de INGESTA_CATEGORIAS, términos distintos del índice BM25 y
  largo promedio de los documentos.
- La calidad: las métricas de GET /metrics/quality y el desglose de
  `duplicados` en sus dos tipos.
- La deduplicación: códigos de barras repetidos en la caché (debe ser 0).
- La última ingesta: su resumen, los motivos de invalidez y la tasa de
  fallas de la fuente, separando las recuperadas en el reintento de las
  perdidas.

Uso, desde python-service/:
    python scripts/estadisticas_corpus.py
    python scripts/estadisticas_corpus.py --db data/otra.sqlite3
    python scripts/estadisticas_corpus.py --categorias en:biscuits,en:breads

Con Docker Compose, sobre la caché del volumen:
    docker compose exec python-service python scripts/estadisticas_corpus.py
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Sequence, Tuple

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.busqueda.estadisticas import (  # noqa: E402
    EstadisticasCorpus,
    calcular_estadisticas,
)
from app.core.config import settings  # noqa: E402
from app.metricas.calidad import (  # noqa: E402
    calcular_metricas_calidad,
    desglose_duplicados,
    fallas_de_la_fuente,
    porcentaje,
)
from app.repositories.cache import (  # noqa: E402
    EjecucionRegistrada,
    RepositorioCache,
)
from app.schemas.metricas import MetricasCalidad  # noqa: E402

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
    """El corpus de búsqueda."""
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


def formatear_calidad(
    metricas: MetricasCalidad,
    ejecuciones: Sequence[EjecucionRegistrada],
    codigos_repetidos: Sequence[Tuple[str, int]],
    posibles_duplicados: int,
) -> str:
    """Métricas de calidad, deduplicación y última ingesta."""
    desglose = desglose_duplicados(ejecuciones)
    lineas = [
        "",
        "Calidad de los datos (GET /metrics/quality, "
        f"{len(ejecuciones)} ingestas terminadas):",
        f"  porcentaje_validos: {metricas.porcentaje_validos}",
        f"  porcentaje_duplicados: {metricas.porcentaje_duplicados}",
        f"  cobertura_ingredientes: {metricas.cobertura_ingredientes}",
        f"  antiguedad_promedio_horas: {metricas.antiguedad_promedio_horas}",
        f"  total_productos: {metricas.total_productos}",
        "Duplicados por tipo (ingestas con detalle):",
        f"  repetidos en la misma ingesta: "
        f"{desglose.repetidos_en_ejecucion}",
        f"  ya estaban en la caché sin cambios: "
        f"{desglose.existentes_sin_cambios}",
        "",
        "Deduplicación en la caché:",
        f"  códigos de barras repetidos: {len(codigos_repetidos)}"
        + (" (OK)" if not codigos_repetidos else " (ERROR)"),
    ]
    lineas += [f"    {codigo}: {veces} veces"
               for codigo, veces in codigos_repetidos]
    lineas.append(f"  productos marcados como posible_duplicado: "
                  f"{posibles_duplicados}")
    lineas += [""] + _ultima_ingesta(ejecuciones)
    return "\n".join(lineas)


def _ultima_ingesta(ejecuciones: Sequence[EjecucionRegistrada]) -> List[str]:
    if not ejecuciones:
        return ["Última ingesta: no hay ingestas terminadas"]
    ultima = ejecuciones[-1]
    r, d = ultima.resumen, ultima.detalle
    lineas = [
        f"Última ingesta ({r.run_id}, {r.estado}):",
        f"  recuperados {r.recuperados}, válidos {r.validos}, inválidos "
        f"{r.invalidos}, duplicados {r.duplicados}, errores {r.errores}",
    ]
    if d is None:
        return lineas + ["  (ingesta anterior al registro del detalle: sin "
                         "desglose ni tasa de fallas)"]
    lineas += [
        f"  duplicados: {d.repetidos_en_ejecucion} repetidos en la "
        f"ingesta + {d.existentes_sin_cambios} ya en la caché",
        "  con ingredientes utilizables: "
        f"{d.con_ingredientes} de {r.recuperados} "
        f"({porcentaje(d.con_ingredientes, r.recuperados)} %)",
        "  motivos de invalidez: " + (", ".join(
            f"{motivo} {n}"
            for motivo, n in sorted(d.motivos_invalidez.items(),
                                    key=lambda par: -par[1])
        ) or "ninguno"),
    ]
    fallas = fallas_de_la_fuente(ultima)
    lineas += [
        f"  fallas de la fuente: {fallas.fallas} de {fallas.peticiones} "
        f"peticiones ({fallas.tasa} %)",
        f"    primera ronda: {fallas.primera_ronda} "
        f"({fallas.recuperadas} recuperadas en el reintento, "
        f"{fallas.perdidas} perdidas)",
        f"    en el reintento: {fallas.en_reintento}",
    ]
    return lineas


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
    corpus = calcular_estadisticas(
        repositorio.listar_productos_con_payload(), categorias
    )
    ejecuciones = repositorio.listar_ejecuciones_terminadas()
    metricas = calcular_metricas_calidad(
        ejecuciones, repositorio.estado_productos(),
        datetime.now(timezone.utc),
    )
    print(formatear(corpus))
    print(formatear_calidad(metricas, ejecuciones,
                            repositorio.codigos_repetidos(),
                            corpus.posibles_duplicados))
    return 0


if __name__ == "__main__":
    sys.exit(main())
