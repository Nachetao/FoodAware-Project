"""Exporta el contrato OpenAPI a docs/contratos/fastapi-openapi.json.

Uso, desde python-service/:
    python scripts/export_openapi.py           # escribe el archivo
    python scripts/export_openapi.py --check   # falla si está desactualizado
"""
import argparse
import json
import sys
from pathlib import Path

RAIZ_SERVICIO = Path(__file__).resolve().parents[1]
DESTINO = RAIZ_SERVICIO.parent / "docs" / "contratos" / "fastapi-openapi.json"

sys.path.insert(0, str(RAIZ_SERVICIO))
from app.main import app  # noqa: E402


def generar() -> str:
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="No escribe; falla si el archivo difiere.")
    parser.add_argument("--destino", type=Path, default=DESTINO)
    args = parser.parse_args(argv)

    contrato = generar()
    if args.check:
        actual = (
            args.destino.read_text(encoding="utf-8").replace("\r\n", "\n")
            if args.destino.exists() else ""
        )
        if actual != contrato:
            print(f"{args.destino} está desactualizado. Ejecuta: "
                  "python scripts/export_openapi.py", file=sys.stderr)
            return 1
        print(f"{args.destino} está al día.")
        return 0

    args.destino.parent.mkdir(parents=True, exist_ok=True)
    args.destino.write_text(contrato, encoding="utf-8", newline="\n")
    print(f"Contrato exportado en {args.destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
