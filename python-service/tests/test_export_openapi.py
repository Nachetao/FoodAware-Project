import importlib.util
import json
from pathlib import Path

RUTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "export_openapi.py"
)
_spec = importlib.util.spec_from_file_location("export_openapi", RUTA_SCRIPT)
export_openapi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export_openapi)

RUTAS_CONTRATO = {
    "/", "/health", "/analizar", "/products/{codigo_barras}", "/search",
    "/ingest/runs", "/ingest/runs/latest", "/metrics/quality",
    "/metrics/evaluation",
}


def test_contrato_incluye_todas_las_rutas():
    contrato = json.loads(export_openapi.generar())
    assert set(contrato["paths"]) == RUTAS_CONTRATO
    assert contrato["info"]["version"] == "0.1.0"
    assert "RespuestaError" in contrato["components"]["schemas"]


def test_exporta_y_check_pasa(tmp_path):
    destino = tmp_path / "contratos" / "fastapi-openapi.json"
    assert export_openapi.main(["--destino", str(destino)]) == 0
    texto = destino.read_text(encoding="utf-8")
    assert "dígitos" in texto and "\\u00ed" not in texto
    assert export_openapi.main(["--check", "--destino", str(destino)]) == 0


def test_check_acepta_finales_crlf(tmp_path):
    destino = tmp_path / "fastapi-openapi.json"
    destino.write_bytes(export_openapi.generar().replace("\n", "\r\n")
                        .encode("utf-8"))
    assert export_openapi.main(["--check", "--destino", str(destino)]) == 0


def test_check_falla_si_difiere_o_no_existe(tmp_path):
    destino = tmp_path / "fastapi-openapi.json"
    assert export_openapi.main(["--check", "--destino", str(destino)]) == 1
    destino.write_text("{}\n", encoding="utf-8")
    assert export_openapi.main(["--check", "--destino", str(destino)]) == 1
