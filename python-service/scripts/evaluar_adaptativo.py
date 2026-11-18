"""Evalúa la capacidad adaptativa contra la versión base y el etiquetado.

No consulta Open Food Facts. Construye el índice desde la caché (o desde la
semilla del corpus, con --semilla) igual que el servicio y calcula lo mismo
que GET /metrics/evaluation/adaptive (ver app/evaluacion/adaptativa.py):

- veredictos de los perfiles de prueba contra el etiquetado manual
  (app/evaluacion/etiquetado_manual.json): falsos apto, falsos no apto y
  matriz de confusión, en modo normal y estricto;
- detección de alérgenos y trazas contra el etiquetado;
- GET /search contra POST /search/personalized en las consultas con
  restricción: Precision@K y productos no aptos en el top K.

Imprime el reporte en Markdown y, con --markdown, lo guarda.

Uso, desde python-service/:
    python scripts/evaluar_adaptativo.py --semilla
    python scripts/evaluar_adaptativo.py --semilla --markdown reporte.md
    python scripts/evaluar_adaptativo.py --db data/otra.sqlite3

Con Docker Compose, sobre la caché del volumen:
    docker compose exec python-service python scripts/evaluar_adaptativo.py
"""
import argparse
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.busqueda.buscador import Instantanea  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.evaluacion.adaptativa import (  # noqa: E402
    VEREDICTOS,
    DeteccionCampo,
    ResultadoEvaluacionAdaptativa,
    evaluar_adaptativa,
)
from app.evaluacion.conjunto import (  # noqa: E402
    RUTA_CONSULTAS,
    cargar_conjunto,
)
from app.evaluacion.etiquetado import (  # noqa: E402
    RUTA_ETIQUETADO,
    cargar_etiquetado,
)
from app.evaluacion.evaluador import K_POR_DEFECTO  # noqa: E402
from app.procesamiento import VERSION_PROCESAMIENTO  # noqa: E402
from app.repositories.cache import RepositorioCache  # noqa: E402
from app.services.semilla import cargar_semilla  # noqa: E402

ABREVIATURAS = {"apto": "A", "apto_con_advertencia": "W", "no_apto": "N"}

LECTURA = """\
## Cómo leer estos resultados

- **Falso "apto"** (el error más grave): el sistema dice `apto` y, según el
  etiquetado manual, el producto contiene algo que el perfil evita. La tasa
  se calcula sobre los productos que lo contienen.
- **Falso "no apto"**: el sistema dice `no_apto` y, según el etiquetado, no
  correspondía. En una app de alergias es el error menos grave (esconde un
  producto que servía), pero hace la app menos útil.
- **Veredicto esperado**: sale del etiquetado con las mismas reglas del
  veredicto (contiene → `no_apto`; traza → `apto_con_advertencia`, o
  `no_apto` en modo estricto; si no, `apto`). Que el sistema advierta cuando
  se esperaba `apto` no es un error: es "ante la duda, advertir".
- **Detección**: precisión y exhaustividad contando pares producto-alérgeno.
  En trazas se comparan las del sistema que no son ya ingrediente.
- **Búsqueda**: Precision@{k} con las reglas de `consultas.json`. Esas reglas
  y el veredicto usan la detección del sistema, así que esta tabla mide el
  ranking dada la detección; la seguridad de la detección la miden las
  tablas anteriores, contra el etiquetado.
- **Etiquetado**: propuesto con asistencia de IA leyendo solo los
  ingredientes y revisado por el equipo; son {revisados} productos elegidos
  por ser difíciles, no una muestra al azar. Ver
  docs/recuperacion-y-evaluacion.md.
"""


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    origen = parser.add_mutually_exclusive_group()
    origen.add_argument("--db", default=settings.cache_db_path,
                        help="Base SQLite (por defecto CACHE_DB_PATH).")
    origen.add_argument("--semilla", action="store_true",
                        help="Usar la semilla del corpus (el corpus de "
                             "staging) en vez de la caché.")
    parser.add_argument("--k", type=int, default=K_POR_DEFECTO,
                        help=f"Resultados por consulta (por defecto "
                             f"{K_POR_DEFECTO}).")
    parser.add_argument("--consultas", type=Path, default=RUTA_CONSULTAS)
    parser.add_argument("--etiquetado", type=Path, default=RUTA_ETIQUETADO)
    parser.add_argument("--markdown", type=Path, default=None,
                        help="Además, guarda el reporte en este archivo.")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = leer_argumentos(argv)
    if args.k < 1:
        print("ERROR: --k debe ser al menos 1", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as temporal:
        if args.semilla:
            repositorio = RepositorioCache(str(Path(temporal) / "c.sqlite3"))
            repositorio.inicializar()
            cargar_semilla(repositorio, settings.off_base_url)
            corpus = "semilla del corpus (python-service/semilla)"
        else:
            if not Path(args.db).exists():
                print(f"ERROR: no existe la caché {args.db}",
                      file=sys.stderr)
                return 2
            repositorio = RepositorioCache(args.db)
            corpus = f"caché {args.db}"
        registros = repositorio.listar_productos_con_payload()
    instantanea = Instantanea.construir(registros)
    resultado = evaluar_adaptativa(
        cargar_etiquetado(args.etiquetado), cargar_conjunto(args.consultas),
        registros, instantanea, args.k,
    )
    texto = reporte_markdown(resultado, corpus, len(instantanea.productos))
    print(texto)
    if args.markdown:
        args.markdown.write_text(texto, encoding="utf-8")
        print(f"Reporte guardado en {args.markdown}", file=sys.stderr)
    return 0


# --- reporte -----------------------------------------------------------------

def reporte_markdown(resultado: ResultadoEvaluacionAdaptativa, corpus: str,
                     productos: int,
                     fecha: Optional[datetime] = None) -> str:
    fecha = fecha or datetime.now(timezone.utc)
    lineas: List[str] = [
        "# Evaluación de la capacidad adaptativa",
        "",
        f"- Fecha: {fecha:%Y-%m-%d %H:%M} UTC",
        f"- Corpus: {corpus}, {productos} productos indexados",
        f"- Versión de procesamiento: {VERSION_PROCESAMIENTO}",
        f"- Etiquetado: {resultado.revisados} productos revisados por el "
        f"equipo, {resultado.evaluados} en el índice",
    ]
    if resultado.no_encontrados:
        lineas.append("- No están en el índice (no se evalúan): "
                      + ", ".join(resultado.no_encontrados))
    lineas += ["", *_tabla_veredictos(resultado), "",
               *_tabla_matrices(resultado), "",
               *_tabla_deteccion(resultado), "",
               *_tabla_busqueda(resultado), "",
               LECTURA.format(k=resultado.k,
                              revisados=resultado.revisados).rstrip()]
    return "\n".join(lineas) + "\n"


def _tasa(valor: Optional[float]) -> str:
    return "n/d" if valor is None else f"{valor:.2f}"


def _codigos(codigos) -> str:
    return ", ".join(codigos) if codigos else "-"


def _tabla_veredictos(resultado: ResultadoEvaluacionAdaptativa) -> List[str]:
    lineas = [
        "## Veredictos contra el etiquetado manual",
        "",
        "| Perfil | Modo | Contienen | Falsos apto | Tasa | Falsos apto "
        "por traza | Falsos no apto | Tasa | Coinciden |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for p in resultado.perfiles:
        lineas.append(
            f"| {p.perfil} | {p.modo} | {p.contienen} de {p.productos} "
            f"| {len(p.falsos_apto)} | {_tasa(p.tasa_falsos_apto)} "
            f"| {len(p.falsos_apto_por_traza)} "
            f"| {len(p.falsos_no_apto)} de {p.no_deberian_ser_no_apto} "
            f"| {_tasa(p.tasa_falsos_no_apto)} "
            f"| {p.coincidencias} de {p.productos_completos} |")
    lineas += ["", "Productos con falsos apto o falsos no apto:", "",
               "| Perfil | Modo | Falsos apto | Falsos no apto |",
               "|---|---|---|---|"]
    lineas += [
        f"| {p.perfil} | {p.modo} | "
        f"{_codigos(p.falsos_apto + p.falsos_apto_por_traza)} | "
        f"{_codigos(p.falsos_no_apto)} |"
        for p in resultado.perfiles
    ]
    return lineas


def _tabla_matrices(resultado: ResultadoEvaluacionAdaptativa) -> List[str]:
    pares = [(e, s) for e in VEREDICTOS for s in VEREDICTOS]
    encabezado = " | ".join(f"{ABREVIATURAS[e]}→{ABREVIATURAS[s]}"
                            for e, s in pares)
    lineas = [
        "## Matrices de confusión",
        "",
        "Esperado → sistema. A = apto, W = apto_con_advertencia, "
        "N = no_apto. Las celdas de la diagonal (A→A, W→W, N→N) son "
        "coincidencias; N→A es un falso apto.",
        "",
        f"| Perfil | Modo | {encabezado} |",
        "|---|---|" + "---:|" * len(pares),
    ]
    for p in resultado.perfiles:
        celdas = " | ".join(str(p.matriz[e][s]) for e, s in pares)
        lineas.append(f"| {p.perfil} | {p.modo} | {celdas} |")
    return lineas


def _fila_deteccion(nombre: str, campo: DeteccionCampo) -> str:
    return (f"| {nombre} | {campo.productos} | {campo.verdaderos_positivos} "
            f"| {campo.falsos_positivos} | {campo.falsos_negativos} "
            f"| {_tasa(campo.precision)} | {_tasa(campo.exhaustividad)} |")


def _tabla_deteccion(resultado: ResultadoEvaluacionAdaptativa) -> List[str]:
    lineas = [
        "## Detección de alérgenos contra el etiquetado",
        "",
        "| Campo | Productos | Correctos | De más | Faltantes | Precisión "
        "| Exhaustividad |",
        "|---|---:|---:|---:|---:|---:|---:|",
        _fila_deteccion("Alérgenos", resultado.deteccion_alergenos),
        _fila_deteccion("Trazas", resultado.deteccion_trazas),
        "",
        "| Producto | Código | Campo | Marcados de más | Faltantes |",
        "|---|---|---|---|---|",
    ]
    for nombre, campo in (("alérgenos", resultado.deteccion_alergenos),
                          ("trazas", resultado.deteccion_trazas)):
        lineas += [
            f"| {d.nombre[:40]} | {d.codigo_barras} | {nombre} "
            f"| {_codigos(d.falsos_positivos)} "
            f"| {_codigos(d.falsos_negativos)} |"
            for d in campo.diferencias
        ]
    return lineas


def _tabla_busqueda(resultado: ResultadoEvaluacionAdaptativa) -> List[str]:
    k = resultado.k
    lineas = [
        f"## Búsqueda base contra personalizada (top {k})",
        "",
        "Base: `GET /search`. Personalizada: `POST /search/personalized` con "
        "perfil vacío y modo filtrar (la restricción sale de la consulta).",
        "",
        f"| Consulta | Relevantes | P@{k} base | P@{k} personalizada "
        f"| No aptos en el top {k} base | No aptos personalizada |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for c in resultado.consultas:
        lineas.append(
            f"| {c.consulta.consulta} | {c.relevantes} "
            f"| {c.precision_base:.2f} | {c.precision_personalizada:.2f} "
            f"| {c.no_aptos_top_base} | {c.no_aptos_top_personalizado} |")
    lineas.append(
        f"| **Promedio** ({len(resultado.consultas_evaluadas)} consultas) "
        f"| | {resultado.precision_base:.2f} "
        f"| {resultado.precision_personalizada:.2f} "
        f"| {resultado.no_aptos_top_base} "
        f"| {resultado.no_aptos_top_personalizado} |")
    return lineas


if __name__ == "__main__":
    sys.exit(main())
