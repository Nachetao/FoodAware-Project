"""Reprocesamiento de la caché desde el payload crudo, sin consultar OFF."""
import importlib.util
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
from app.services.mapeo_off import mapear_producto
from app.services.reprocesamiento import reprocesar_cache
from tests.payloads_off import GALLETAS, INCOMPLETO, LECHE

pytestmark = pytest.mark.recuperacion

BASE = "https://world.openfoodfacts.org"
RUN_ID = uuid.UUID("3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b")
AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)

RUTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "reprocesar_cache.py"
)
_spec = importlib.util.spec_from_file_location("reprocesar_cache",
                                               RUTA_SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


def mapear(payload):
    return mapear_producto(payload, run_id=RUN_ID, recuperado_en=AHORA,
                           base_url=BASE)


def guardar_procesado_con_reglas_viejas(repo, payload):
    """Como lo habría dejado una versión anterior del procesamiento."""
    viejo = mapear(payload).model_copy(update={
        "ingredientes": ["_leche_ entera", "vitamina a", "vitamina d3."],
        "alergenos": [],
        "calidad": Calidad(es_valido=True, problemas=[], completitud=1.0),
    })
    repo.guardar_producto(viejo, payload, AHORA, version=0)


@pytest.fixture
def repo(tmp_path):
    repositorio = RepositorioCache(str(tmp_path / "cache.sqlite3"))
    repositorio.inicializar()
    return repositorio


def test_reprocesa_desde_el_payload_guardado(repo):
    guardar_procesado_con_reglas_viejas(repo, LECHE)
    repo.guardar_producto(mapear(GALLETAS), GALLETAS)

    resumen = reprocesar_cache(repo, BASE)

    assert resumen.reprocesados == 1 and resumen.errores == 0
    cacheado = repo.obtener_producto(LECHE["code"])
    producto = cacheado.producto
    assert producto.ingredientes == ["leche entera", "vitamina a",
                                     "vitamina d3"]
    assert [a.value for a in producto.alergenos] == ["lacteos"]
    # La procedencia sigue siendo la de la descarga original.
    assert producto.procedencia.run_id == RUN_ID
    assert producto.procedencia.recuperado_en == AHORA
    assert cacheado.verificado_en == AHORA
    assert producto == mapear(LECHE)
    assert repo.listar_para_reprocesar(VERSION_PROCESAMIENTO) == []


def test_solo_reprocesa_versiones_anteriores_salvo_todos(repo):
    repo.guardar_producto(mapear(LECHE), LECHE)
    repo.guardar_producto(mapear(GALLETAS), GALLETAS)
    assert reprocesar_cache(repo, BASE).reprocesados == 0
    assert reprocesar_cache(repo, BASE, todos=True).reprocesados == 2


def test_resumen_del_reprocesamiento(repo):
    gemela = {**LECHE, "code": "7801234000018"}
    solo_texto = {**GALLETAS, "allergens_tags": [], "traces_tags": []}
    con_e322 = {**LECHE, "code": "7805678000023", "product_name_es": "Bebida",
                "ingredients_text_es": "Agua, emulsionante (E322)",
                "allergens_tags": []}
    for payload in (LECHE, gemela, solo_texto, con_e322, INCOMPLETO):
        repo.guardar_producto(mapear(payload), payload, version=0)

    resumen = reprocesar_cache(repo, BASE)

    assert resumen.total == 5 and resumen.reprocesados == 5
    assert resumen.validos == 4 and resumen.invalidos == 1
    assert resumen.motivos_invalidez == {"sin_nombre": 1,
                                         "sin_ingredientes": 1}
    assert resumen.alergenos_en_texto == {
        "gluten": 1, "lacteos": 1, "huevo": 1, "soya": 1
    }
    assert resumen.trazas_en_texto == {"frutos_secos": 1}
    assert resumen.alergenos_posibles == {"soya": 1}
    assert resumen.posibles_duplicados == 2


def test_payload_irrecuperable_se_cuenta_y_no_se_pierde(repo):
    guardar_procesado_con_reglas_viejas(repo, LECHE)
    # Un payload corrupto: el producto queda como estaba.
    with repo._conexion() as con:
        con.execute("UPDATE productos SET payload_off = '{\"code\": \"x\"}'")

    resumen = reprocesar_cache(repo, BASE)

    assert resumen.errores == 1 and resumen.reprocesados == 0
    assert repo.obtener_producto(LECHE["code"]).producto.ingredientes[0] == (
        "_leche_ entera"
    )
    # Se reintenta en el próximo arranque.
    assert len(repo.listar_para_reprocesar(VERSION_PROCESAMIENTO)) == 1


def test_al_iniciar_el_servicio_reprocesa_sin_llamar_a_off(
    tmp_path, monkeypatch
):
    ruta = str(tmp_path / "cache.sqlite3")
    repositorio = RepositorioCache(ruta)
    repositorio.inicializar()
    guardar_procesado_con_reglas_viejas(repositorio, LECHE)
    monkeypatch.setattr(config.settings, "cache_db_path", ruta)
    # Sin User-Agent no existe cliente de OFF: no puede haber llamadas.
    monkeypatch.setattr(config.settings, "off_user_agent", None)

    with TestClient(app) as cliente:
        datos = cliente.get(f"/products/{LECHE['code']}").json()

    assert datos["ingredientes"] == ["leche entera", "vitamina a",
                                     "vitamina d3"]
    assert datos["alergenos"] == ["lacteos"]
    assert repositorio.listar_para_reprocesar(VERSION_PROCESAMIENTO) == []


def test_script_muestra_resumen(repo, capsys):
    guardar_procesado_con_reglas_viejas(repo, LECHE)
    repo.guardar_producto(mapear(INCOMPLETO), INCOMPLETO, version=0)

    assert script.main(["--db", repo.ruta]) == 0

    salida = capsys.readouterr().out
    assert "Productos en caché: 2" in salida
    assert "Reprocesados: 2 (errores: 0)" in salida
    assert "Válidos: 1" in salida
    assert "Inválidos: 1" in salida
    assert "sin_nombre 1" in salida
    assert "Productos con posibles duplicados: 0" in salida
    # Ya está al día: sin --todos no reprocesa nada.
    assert script.main(["--db", repo.ruta]) == 0
    assert "Reprocesados: 0" in capsys.readouterr().out
    assert script.main(["--db", repo.ruta, "--todos"]) == 0
    assert "Reprocesados: 2" in capsys.readouterr().out


def test_script_sin_cache(tmp_path, capsys):
    assert script.main(["--db", str(tmp_path / "no-existe.sqlite3")]) == 2
    assert "no existe" in capsys.readouterr().err
