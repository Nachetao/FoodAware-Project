"""Semilla del corpus: exportación, carga al iniciar y archivo versionado."""
import gzip
import importlib.util
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.main import app
from app.procesamiento import VERSION_PROCESAMIENTO
from app.repositories.cache import RepositorioCache
from app.schemas.producto import Calidad
from app.services import semilla
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import GALLETAS, INCOMPLETO, LECHE

pytestmark = pytest.mark.recuperacion

BASE = "https://world.openfoodfacts.org"
RUN_ID = uuid.UUID("3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b")
RECUPERADO = datetime(2026, 10, 1, 9, 30, tzinfo=timezone.utc)
VERIFICADO = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)

RUTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "exportar_semilla.py"
)
_spec = importlib.util.spec_from_file_location("exportar_semilla",
                                               RUTA_SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


def mapear(payload):
    return mapear_producto(payload, run_id=RUN_ID, recuperado_en=RECUPERADO,
                           base_url=BASE)


def nuevo_repo(tmp_path, nombre):
    repositorio = RepositorioCache(str(tmp_path / nombre))
    repositorio.inicializar()
    return repositorio


@pytest.fixture
def origen(tmp_path):
    """Caché con un producto válido procesado con reglas viejas, otro al
    día y uno inválido."""
    repo = nuevo_repo(tmp_path, "origen.sqlite3")
    viejo = mapear(LECHE).model_copy(update={
        "ingredientes": ["_leche_ entera", "vitamina a", "vitamina d3."],
        "alergenos": [],
        "calidad": Calidad(es_valido=True, problemas=[], completitud=1.0),
    })
    repo.guardar_producto(viejo, LECHE, VERIFICADO, version=0)
    repo.guardar_producto(mapear(GALLETAS), GALLETAS, VERIFICADO)
    repo.guardar_producto(mapear(INCOMPLETO), INCOMPLETO, VERIFICADO)
    return repo


@pytest.fixture
def archivo(origen, tmp_path):
    ruta = tmp_path / "semilla" / "corpus-off.json.gz"
    semilla.exportar_semilla(origen, ruta)
    return ruta


def test_exporta_solo_los_validos_con_payload_y_procedencia(archivo):
    contenido = json.loads(gzip.decompress(archivo.read_bytes()))

    assert contenido["formato"] == semilla.FORMATO_SEMILLA
    assert contenido["version_procesamiento"] == VERSION_PROCESAMIENTO
    assert "Open Food Facts" in contenido["fuente"]
    assert "ODbL" in contenido["licencia"]
    productos = contenido["productos"]
    # INCOMPLETO no es válido; el orden es por código de barras.
    assert [p["payload_off"]["code"] for p in productos] == sorted(
        [LECHE["code"], GALLETAS["code"]]
    )
    leche = next(p for p in productos
                 if p["payload_off"]["code"] == LECHE["code"])
    assert leche["payload_off"] == LECHE
    assert leche["version_procesamiento"] == 0
    assert leche["procedencia"]["run_id"] == str(RUN_ID)
    assert leche["verificado_en"] == "2026-10-20T18:00:00Z"


def test_dos_exportaciones_del_mismo_corpus_solo_cambian_la_fecha(
    origen, tmp_path
):
    rutas = [tmp_path / "a.json.gz", tmp_path / "b.json.gz"]
    for ruta in rutas:
        semilla.exportar_semilla(origen, ruta)
    contenidos = [json.loads(gzip.decompress(r.read_bytes())) for r in rutas]
    for contenido in contenidos:
        contenido.pop("exportado_en")
    assert contenidos[0] == contenidos[1]


def test_carga_en_cache_vacia_con_la_version_actual(archivo, tmp_path):
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    resumen = semilla.cargar_semilla_si_vacia(destino, BASE, archivo)

    assert resumen == semilla.ResumenSemilla(total=2, cargados=2, errores=0)
    assert destino.contar_productos() == 2
    # Reprocesada con las reglas actuales, no con las de la exportación.
    assert destino.listar_para_reprocesar(VERSION_PROCESAMIENTO) == []
    cacheado = destino.obtener_producto(LECHE["code"])
    producto = cacheado.producto
    assert producto.ingredientes == ["leche entera", "vitamina a",
                                     "vitamina d3"]
    assert [a.value for a in producto.alergenos] == ["lacteos"]
    # Conserva la procedencia de la descarga original.
    assert producto.procedencia.run_id == RUN_ID
    assert producto.procedencia.recuperado_en == RECUPERADO
    assert cacheado.verificado_en == VERIFICADO
    assert producto == mapear(LECHE)


def test_no_carga_si_la_cache_ya_tiene_productos(archivo, tmp_path):
    destino = nuevo_repo(tmp_path, "destino.sqlite3")
    destino.guardar_producto(mapear(LECHE), LECHE)

    assert semilla.cargar_semilla_si_vacia(destino, BASE, archivo) is None
    assert destino.contar_productos() == 1


def test_sin_archivo_no_carga_ni_falla(tmp_path):
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    resumen = semilla.cargar_semilla_si_vacia(
        destino, BASE, tmp_path / "no-existe.json.gz"
    )

    assert resumen is None
    assert destino.contar_productos() == 0


@pytest.mark.parametrize(
    "contenido",
    [
        b"no es gzip",
        gzip.compress(b"{no es json"),
        gzip.compress(json.dumps({"formato": 99, "productos": []}).encode()),
        gzip.compress(json.dumps({"formato": 1}).encode()),
    ],
)
def test_archivo_danado_no_impide_arrancar(tmp_path, contenido, caplog):
    ruta = tmp_path / "corpus-off.json.gz"
    ruta.write_bytes(contenido)
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    assert semilla.cargar_semilla_si_vacia(destino, BASE, ruta) is None
    assert destino.contar_productos() == 0
    assert "No se cargó la semilla" in caplog.text


def test_omite_los_productos_que_no_se_pueden_procesar(archivo, tmp_path):
    contenido = json.loads(gzip.decompress(archivo.read_bytes()))
    contenido["productos"].append({"payload_off": {"code": "abc"},
                                   "procedencia": {"run_id": str(RUN_ID),
                                                   "recuperado_en":
                                                   "2026-10-01T09:30:00Z"}})
    contenido["productos"].append({"sin": "payload"})
    archivo.write_bytes(gzip.compress(json.dumps(contenido).encode()))
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    resumen = semilla.cargar_semilla(destino, BASE, archivo)

    assert resumen == semilla.ResumenSemilla(total=4, cargados=2, errores=2)


def test_al_iniciar_carga_la_semilla_y_arma_el_indice_sin_llamar_a_off(
    archivo, tmp_path, monkeypatch
):
    monkeypatch.setattr(config.settings, "cache_db_path",
                        str(tmp_path / "cache.sqlite3"))
    monkeypatch.setattr(config.settings, "cargar_semilla_si_vacia", True)
    # Sin User-Agent no existe cliente de OFF: no puede haber llamadas.
    monkeypatch.setattr(config.settings, "off_user_agent", None)
    monkeypatch.setattr(semilla, "RUTA_SEMILLA", archivo)

    with TestClient(app) as cliente:
        busqueda = cliente.get("/search", params={"q": "leche"}).json()
        salud = cliente.get("/health").json()

    assert LECHE["code"] in [r["producto"]["codigo_barras"]
                             for r in busqueda["resultados"]]
    assert salud["detalle"]["cache"]["productos"] == 2
    assert salud["detalle"]["indice"]["productos"] == 2


def test_con_la_variable_desactivada_no_carga(archivo, tmp_path,
                                              monkeypatch):
    monkeypatch.setattr(config.settings, "cache_db_path",
                        str(tmp_path / "cache.sqlite3"))
    monkeypatch.setattr(config.settings, "off_user_agent", None)
    monkeypatch.setattr(semilla, "RUTA_SEMILLA", archivo)

    with TestClient(app) as cliente:
        salud = cliente.get("/health").json()

    assert salud["detalle"]["cache"]["productos"] == 0


def test_script_exporta_la_semilla(origen, tmp_path, capsys):
    salida = tmp_path / "corpus.json.gz"

    assert script.main(["--db", origen.ruta, "--salida", str(salida)]) == 0

    texto = capsys.readouterr().out
    assert "Semilla: 2 productos válidos de 3 en caché" in texto
    assert salida.exists()


def test_script_sin_cache_termina_con_error(tmp_path):
    assert script.main(["--db", str(tmp_path / "no-existe.sqlite3")]) == 2


def test_la_semilla_versionada_se_carga_completa(tmp_path):
    """El archivo del repositorio (el que usa Render) es válido y todos sus
    productos se procesan con las reglas actuales."""
    contenido = semilla.leer_semilla(semilla.RUTA_SEMILLA)
    assert "ODbL" in contenido["licencia"]
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    resumen = semilla.cargar_semilla(destino, BASE)

    assert resumen.total > 0
    assert resumen.errores == 0
    assert resumen.cargados == resumen.total == destino.contar_productos()
