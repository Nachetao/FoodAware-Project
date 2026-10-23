"""Carga en la caché un conjunto fijo de productos de prueba.

Para CI y pruebas de integración: no consulta Open Food Facts. Los payloads
tienen la forma de la API de OFF (marcas y códigos ficticios, prefijo
780999) y pasan por la misma preparación que la ingesta real (mapeo,
limpieza de ingredientes, alérgenos y calidad) antes de guardarse. Volver a
cargarlos no duplica nada: se guardan por código de barras.

Muestra una línea por producto (código, resultado y nombre) y termina con
error si alguno no queda válido.

Uso, desde python-service/:
    python scripts/cargar_fixtures.py
    python scripts/cargar_fixtures.py --db data/otra.sqlite3

Con Docker Compose, antes de levantar el servicio (el índice de búsqueda se
arma al iniciar):
    docker compose run --rm python-service python scripts/cargar_fixtures.py
"""
import argparse
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.core.config import settings  # noqa: E402
from app.repositories.cache import RepositorioCache  # noqa: E402
from app.services.mapeo_off import mapear_producto  # noqa: E402

# 2026-10-01 00:00 UTC: fecha fija para que el contenido no cambie.
MODIFICADO_T = 1790812800


def _payload(codigo: str, nombre: str, marca: str, ingredientes: str,
             **extra: Any) -> Dict[str, Any]:
    return {
        "code": codigo,
        "product_name_es": nombre,
        "brands": marca,
        "quantity": "200 g",
        "ingredients_text_es": ingredientes,
        "nutriscore_grade": "c",
        "image_front_url": "https://images.openfoodfacts.org/fixture.jpg",
        "allergens_tags": [],
        "traces_tags": [],
        "labels_tags": [],
        "last_modified_t": MODIFICADO_T,
        **extra,
    }


PRODUCTOS: List[Dict[str, Any]] = [
    _payload(
        "7809990000013", "Galletas de avena con miel", "Campo Austral",
        "Hojuelas de avena, harina de trigo, azúcar, miel 5%, aceite "
        "vegetal, sal. Puede contener maní.",
        allergens_tags=["en:gluten"], traces_tags=["en:peanuts"],
    ),
    _payload(
        "7809990000020", "Galletas con chips de chocolate", "Campo Austral",
        "Harina de trigo, azúcar, chips de chocolate (azúcar, pasta de "
        "cacao, manteca de cacao, lecitina de soya), mantequilla, huevo, "
        "sal.",
        allergens_tags=["en:gluten", "en:milk", "en:eggs", "en:soybeans"],
    ),
    _payload(
        "7809990000037", "Galletas de arroz sin gluten", "Valle Sur",
        "Arroz integral, aceite de girasol, sal. Sin gluten.",
        labels_tags=["en:no-gluten", "en:vegan"],
    ),
    _payload(
        "7809990000044", "Leche entera", "Lácteos del Sur",
        "Leche entera, vitamina A, vitamina D3.",
        quantity="1 L", allergens_tags=["en:milk"],
    ),
    _payload(
        "7809990000051", "Bebida vegetal de arveja sabor original",
        "Planta Viva",
        "Agua, proteína de arveja, aceite de girasol, carbonato de calcio, "
        "sabor leche (saborizante natural), sal, vitamina D2.",
        quantity="1 L", labels_tags=["en:vegan"],
    ),
    _payload(
        "7809990000068", "Pan de molde integral", "Horno Andino",
        "Harina integral de trigo, agua, levadura, gluten de trigo, "
        "semillas de sésamo, sal.",
        quantity="550 g", allergens_tags=["en:gluten", "en:sesame-seeds"],
    ),
    _payload(
        "7809990000075", "Chocolate amargo 70% cacao", "Cacao Austral",
        "Pasta de cacao, azúcar, manteca de cacao, lecitina de girasol. "
        "Elaborado en una línea que procesa leche y frutos secos.",
        quantity="100 g", traces_tags=["en:milk", "en:nuts"],
    ),
    _payload(
        "7809990000082", "Cereal de maíz azucarado", "Valle Sur",
        "Maíz, azúcar, sal, extracto de malta de cebada, vitaminas.",
        quantity="350 g", allergens_tags=["en:gluten"],
    ),
]


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=settings.cache_db_path,
                        help="Base SQLite (por defecto CACHE_DB_PATH).")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = leer_argumentos(argv)
    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    repositorio = RepositorioCache(args.db)
    repositorio.inicializar()
    run_id = uuid.uuid4()
    ahora = datetime.now(timezone.utc)
    invalidos = 0
    for payload in PRODUCTOS:
        producto = mapear_producto(payload, run_id=run_id, recuperado_en=ahora,
                                   base_url=settings.off_base_url)
        resultado = repositorio.guardar_producto(producto, payload)
        print(f"{producto.codigo_barras}\t{resultado.value}\t"
              f"{producto.nombre}")
        if not producto.calidad.es_valido:
            invalidos += 1
            print(f"ERROR: {producto.codigo_barras} no es válido: "
                  f"{producto.calidad.problemas}", file=sys.stderr)
    return 1 if invalidos else 0


if __name__ == "__main__":
    sys.exit(main())
