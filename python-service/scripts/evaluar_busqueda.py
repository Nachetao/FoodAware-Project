"""Evalúa la búsqueda BM25 sobre la caché con Precision@K y Recall@K.

No consulta Open Food Facts. Construye el índice desde la caché igual que
el servicio, corre el conjunto de evaluación (app/evaluacion/consultas.json)
y muestra una tabla por consulta (tipo, relevantes en el corpus, P@K, R@K,
tiempo) y los promedios macro por tipo y globales.

Uso, desde python-service/:
    python scripts/evaluar_busqueda.py
    python scripts/evaluar_busqueda.py --k 10
    python scripts/evaluar_busqueda.py --markdown reporte_evaluacion.md

Con Docker Compose, sobre la caché del volumen:
    docker compose exec python-service python scripts/evaluar_busqueda.py
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.busqueda.buscador import Instantanea  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.evaluacion.conjunto import (  # noqa: E402
    RUTA_CONSULTAS,
    cargar_conjunto,
)
from app.evaluacion.evaluador import (  # noqa: E402
    K_POR_DEFECTO,
    ResultadoEvaluacion,
    evaluar_instantanea,
)
from app.repositories.cache import RepositorioCache  # noqa: E402

TIPOS = {"producto": "Producto", "restriccion": "Restricción"}

LECTURA = """\
## Cómo leer estos resultados

- **Precision@{k}**: de los primeros {k} resultados, qué fracción es
  relevante. Se divide por {k} aunque haya menos resultados, así que una
  consulta con menos de {k} relevantes en el corpus no puede llegar a 1.
- **Recall@{k}**: de todos los relevantes del corpus, qué fracción aparece
  en los primeros {k}. Si hay más de {k} relevantes, no puede llegar a 1.
- **Relevantes**: se cuentan con las reglas de `app/evaluacion/consultas.json`
  (categorías, frases en el nombre, alérgenos y trazas) sobre todo el corpus
  indexado, por eso el recall es exacto. Los promedios son macro: cada
  consulta pesa lo mismo. Las consultas sin relevantes se excluyen.
- **Consultas con restricción** ("galletas sin gluten"): se espera menor
  precisión, y no es un error de la implementación. BM25 trata "sin" como una
  palabra más y premia los productos que mencionan "gluten" en el nombre, los
  ingredientes o las categorías, que son justamente los que la persona quiere
  evitar. Solo acierta cuando el producto dice "sin gluten" en su nombre.
  Responder bien exige entender la restricción y filtrar por los alérgenos
  detectados (ingredientes y trazas) en vez de rankear solo por texto: es la
  capacidad adaptativa que aporta el Módulo 3.
"""


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=settings.cache_db_path,
                        help="Base SQLite (por defecto CACHE_DB_PATH).")
    parser.add_argument("--k", type=int, default=K_POR_DEFECTO,
                        help=f"Resultados por consulta (por defecto "
                             f"{K_POR_DEFECTO}).")
    parser.add_argument("--consultas", type=Path, default=RUTA_CONSULTAS,
                        help="Conjunto de evaluación en JSON.")
    parser.add_argument("--markdown", type=Path, default=None,
                        help="Además, guarda el reporte en este archivo.")
    args = parser.parse_args(argv)
    if not 1 <= args.k <= 50:
        parser.error("--k debe estar entre 1 y 50")
    return args


def _numero(valor) -> str:
    return "—" if valor is None else f"{valor:.2f}"


def reporte(resultado: ResultadoEvaluacion, fecha: datetime) -> str:
    k = resultado.k
    lineas: List[str] = [
        "# Evaluación de la búsqueda (BM25)",
        "",
        f"- Fecha: {fecha:%Y-%m-%d %H:%M} UTC",
        f"- Corpus: {resultado.total_productos} productos válidos indexados",
        f"- Conjunto de evaluación: versión {resultado.version_conjunto}, "
        f"{len(resultado.por_consulta)} consultas",
        f"- K = {k}",
        "",
        "## Resultados por consulta",
        "",
        f"| Consulta | Tipo | Relevantes | P@{k} | R@{k} | Tiempo (ms) |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for r in resultado.por_consulta:
        lineas.append(
            f"| {r.consulta.consulta} | {TIPOS[r.consulta.tipo]} | "
            f"{r.relevantes} | "
            f"{_numero(r.precision) if r.evaluada else '—'} | "
            f"{_numero(r.recall)} | {r.tiempo_ms:.2f} |"
        )
    lineas += [
        "",
        "## Promedios (macro, solo consultas con relevantes)",
        "",
        f"| Grupo | Consultas | P@{k} | R@{k} | Tiempo promedio (ms) |",
        "|---|---:|---:|---:|---:|",
    ]
    grupos = [(nombre, tipo) for tipo, nombre in TIPOS.items()]
    for nombre, tipo in grupos + [("**Global**", None)]:
        p = resultado.promedio(tipo)
        lineas.append(f"| {nombre} | {p.consultas} | {p.precision:.2f} | "
                      f"{p.recall:.2f} | {p.tiempo_ms:.2f} |")
    lineas += ["", "## Consultas excluidas (sin relevantes en el corpus)",
               ""]
    lineas += ([f"- {r.consulta.consulta} ({r.consulta.id})"
                for r in resultado.excluidas] or ["- Ninguna."])
    lineas += ["", LECTURA.format(k=k)]
    return "\n".join(lineas)


def main(argv=None) -> int:
    args = leer_argumentos(argv)
    if not Path(args.db).exists():
        print(f"ERROR: no existe la caché {args.db}", file=sys.stderr)
        return 2
    repositorio = RepositorioCache(args.db)
    repositorio.inicializar()  # agrega columnas nuevas si es una base antigua
    registros = repositorio.listar_productos_con_payload()
    resultado = evaluar_instantanea(
        cargar_conjunto(args.consultas), registros,
        Instantanea.construir(registros), args.k,
    )
    texto = reporte(resultado, datetime.now(timezone.utc))
    print(texto)
    if args.markdown is not None:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(texto, encoding="utf-8")
        print(f"\nReporte guardado en {args.markdown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
