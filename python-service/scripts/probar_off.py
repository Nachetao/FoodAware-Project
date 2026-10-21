"""Prueba manual contra la API REAL de Open Food Facts. No va en el pipeline.

Hace una ingesta pequeña (máximo 20 productos de Chile: 1 búsqueda) y una
lectura de producto con la API v3 (1 lectura), usando OFF_USER_AGENT del
.env de la raíz del repositorio. Usa una base SQLite temporal, así que no
toca la caché del servicio.

Uso, desde python-service/:
    python scripts/probar_off.py
    python scripts/probar_off.py --codigo 7801234567890 --max-productos 10
"""
import argparse
import asyncio
import logging
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_SERVICIO))

from app.clients.open_food_facts import ClienteOpenFoodFacts  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.errores import ErrorAPI  # noqa: E402
from app.repositories.cache import RepositorioCache  # noqa: E402
from app.schemas.ingesta import SolicitudIngesta  # noqa: E402
from app.services.ingesta import ServicioIngesta  # noqa: E402
from app.services.mapeo_off import mapear_producto  # noqa: E402

MAX_PRODUCTOS = 20


def leer_argumentos(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", type=Path,
                        default=RAIZ_SERVICIO.parent / ".env",
                        help="Archivo .env con OFF_USER_AGENT.")
    parser.add_argument("--codigo",
                        help="Código a leer; por defecto, el primero que "
                             "devuelva la ingesta.")
    parser.add_argument("--max-productos", type=int, default=MAX_PRODUCTOS)
    args = parser.parse_args(argv)
    if not 1 <= args.max_productos <= MAX_PRODUCTOS:
        parser.error(f"--max-productos debe estar entre 1 y {MAX_PRODUCTOS}")
    return args


def resumir(producto) -> str:
    alergenos = ", ".join(a.value for a in producto.alergenos) or "-"
    return (f"{producto.codigo_barras}  {producto.nombre[:40]:<40}  "
            f"alérgenos: {alergenos}  completitud: "
            f"{producto.calidad.completitud}")


async def principal(args: argparse.Namespace) -> int:
    settings = Settings(_env_file=args.env)
    try:
        cliente = ClienteOpenFoodFacts.desde_settings(settings)
    except ValueError as exc:
        print(f"ERROR: {exc}. Defínelo en {args.env}", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as carpeta:
        repositorio = RepositorioCache(str(Path(carpeta) / "prueba.sqlite3"))
        repositorio.inicializar()
        async with cliente:
            print(f"1) Ingesta real: hasta {args.max_productos} productos "
                  f"de Chile desde {settings.off_base_url}")
            servicio = ServicioIngesta(repositorio, cliente,
                                       settings.off_base_url)
            solicitud = SolicitudIngesta(pais="chile",
                                         max_productos=args.max_productos)
            resumen, _ = await servicio.iniciar(solicitud)
            final = await servicio.ejecutar(resumen, solicitud)
            print(final.model_dump_json(indent=2))
            for error in repositorio.listar_errores_fuente(final.run_id):
                print(f"   error de la fuente: {error.tipo}: {error.mensaje}")
            productos = repositorio.listar_productos()
            for producto in productos[:5]:
                print("   -", resumir(producto))

            codigo = args.codigo or (
                productos[0].codigo_barras if productos else None
            )
            if codigo is None:
                print("No hay un código para la lectura de producto.")
                return 1
            print(f"\n2) Lectura real del producto {codigo} (API v3)")
            try:
                payload = await cliente.obtener_producto(codigo)
            except ErrorAPI as exc:
                print(f"ERROR {exc.codigo.value}: {exc.mensaje}",
                      file=sys.stderr)
                return 1
            producto = mapear_producto(
                payload,
                run_id=uuid.uuid4(),
                recuperado_en=datetime.now(timezone.utc),
                base_url=settings.off_base_url,
            )
            print("   -", resumir(producto))
            print(producto.model_dump_json(
                indent=2, include={"marca", "cantidad", "trazas",
                                   "etiquetas_dieta", "nutriscore",
                                   "procedencia", "calidad"},
            ))
    return 0 if final.estado != "fallido" else 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    sys.exit(asyncio.run(principal(leer_argumentos())))
