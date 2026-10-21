import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core import config
from app.repositories.cache import RepositorioCache, ResultadoUpsert
from app.schemas.ingesta import ResumenIngesta
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import GALLETAS, LECHE

RUN_ID = uuid.UUID("3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b")
AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def mapear(payload, run_id=RUN_ID):
    return mapear_producto(payload, run_id=run_id, recuperado_en=AHORA,
                           base_url="https://world.openfoodfacts.org")


@pytest.fixture
def repo(tmp_path):
    repositorio = RepositorioCache(str(tmp_path / "sub" / "cache.sqlite3"))
    repositorio.inicializar()
    return repositorio


def resumen(run_id, inicio, estado="en_curso", **cambios):
    datos = dict(run_id=run_id, inicio=inicio, recuperados=0, validos=0,
                 invalidos=0, duplicados=0, errores=0, estado=estado)
    datos.update(cambios)
    return ResumenIngesta(**datos)


def test_inicializar_crea_tablas_y_es_idempotente(repo):
    repo.inicializar()
    con = sqlite3.connect(repo.ruta)
    tablas = {f[0] for f in con.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'")}
    con.close()
    assert {"productos", "ejecuciones_ingesta", "errores_fuente"} <= tablas


def test_insertar_y_obtener(repo):
    producto = mapear(LECHE)
    assert repo.guardar_producto(producto, LECHE, AHORA) == "insertado"
    cacheado = repo.obtener_producto(producto.codigo_barras)
    assert cacheado.producto == producto
    assert cacheado.verificado_en == AHORA
    assert repo.obtener_payload_off(producto.codigo_barras) == LECHE


def test_mismo_hash_es_duplicado_y_no_reescribe(repo):
    producto = mapear(LECHE)
    repo.guardar_producto(producto, LECHE, AHORA)
    despues = AHORA + timedelta(hours=30)
    otro_payload = {**LECHE, "lang": "en"}
    resultado = repo.guardar_producto(
        mapear(LECHE, run_id=uuid.uuid4()), otro_payload, despues
    )
    assert resultado is ResultadoUpsert.duplicado
    cacheado = repo.obtener_producto(producto.codigo_barras)
    assert cacheado.producto.procedencia.run_id == RUN_ID
    assert repo.obtener_payload_off(producto.codigo_barras) == LECHE
    # Solo se registra que el producto se volvió a confirmar.
    assert cacheado.verificado_en == despues


def test_hash_distinto_actualiza(repo):
    repo.guardar_producto(mapear(LECHE), LECHE, AHORA)
    cambiado = {**LECHE, "ingredients_text_es": "Leche entera."}
    nuevo_run = uuid.uuid4()
    resultado = repo.guardar_producto(mapear(cambiado, nuevo_run), cambiado)
    assert resultado is ResultadoUpsert.actualizado
    producto = repo.obtener_producto(LECHE["code"]).producto
    assert producto.ingredientes == ["leche entera"]
    assert producto.procedencia.run_id == nuevo_run
    assert repo.contar_productos() == 1


def test_listar_y_contar(repo):
    assert repo.listar_productos() == [] and repo.contar_productos() == 0
    repo.guardar_producto(mapear(LECHE), LECHE)
    repo.guardar_producto(mapear(GALLETAS), GALLETAS)
    codigos = [p.codigo_barras for p in repo.listar_productos()]
    assert codigos == sorted([LECHE["code"], GALLETAS["code"]])
    assert repo.contar_productos() == 2


def test_producto_inexistente(repo):
    assert repo.obtener_producto("7800000000000") is None
    assert repo.obtener_payload_off("7800000000000") is None


def test_ejecuciones_crear_actualizar_y_ultima(repo):
    assert repo.ultima_ejecucion() is None
    vieja, nueva = uuid.uuid4(), uuid.uuid4()
    repo.guardar_ejecucion(resumen(
        vieja, AHORA - timedelta(days=1), "completado",
        fin=AHORA - timedelta(hours=23),
    ))
    repo.guardar_ejecucion(resumen(nueva, AHORA))
    assert repo.ultima_ejecucion().run_id == nueva
    terminada = resumen(
        nueva, AHORA, "completado_con_errores",
        fin=AHORA + timedelta(minutes=2), duracion_ms=120000,
        recuperados=20, validos=18, invalidos=2, duplicados=3, errores=1,
    )
    repo.guardar_ejecucion(terminada)
    assert repo.obtener_ejecucion(nueva) == terminada
    assert repo.obtener_ejecucion(uuid.uuid4()) is None


def test_ultima_terminada_e_interrumpidas(repo):
    terminada, en_curso = uuid.uuid4(), uuid.uuid4()
    repo.guardar_ejecucion(resumen(
        terminada, AHORA - timedelta(hours=2), "completado",
        fin=AHORA - timedelta(hours=1),
    ))
    repo.guardar_ejecucion(resumen(en_curso, AHORA))
    assert repo.ultima_ejecucion().run_id == en_curso
    assert repo.ultima_ejecucion_terminada().run_id == terminada
    assert repo.marcar_ejecuciones_interrumpidas(AHORA) == 1
    interrumpida = repo.obtener_ejecucion(en_curso)
    assert interrumpida.estado == "fallido" and interrumpida.fin == AHORA
    assert repo.marcar_ejecuciones_interrumpidas() == 0


def test_errores_fuente(repo):
    otro = uuid.uuid4()
    repo.registrar_error_fuente("SOURCE_TIMEOUT", "lento", RUN_ID, AHORA)
    repo.registrar_error_fuente("SOURCE_UNAVAILABLE", "HTTP 503", RUN_ID,
                                AHORA + timedelta(seconds=1))
    repo.registrar_error_fuente("SOURCE_UNAVAILABLE", "sin red", otro)
    errores = repo.listar_errores_fuente(RUN_ID)
    assert [e.mensaje for e in errores] == ["HTTP 503", "lento"]
    assert errores[0].run_id == RUN_ID
    assert errores[0].tipo == "SOURCE_UNAVAILABLE"
    assert len(repo.listar_errores_fuente(limite=1)) == 1
    assert len(repo.listar_errores_fuente()) == 3


def test_los_datos_persisten_en_el_archivo(repo):
    repo.guardar_producto(mapear(LECHE), LECHE)
    otra_instancia = RepositorioCache(repo.ruta)
    assert otra_instancia.obtener_producto(LECHE["code"]) is not None


def test_cache_db_path_desde_entorno(monkeypatch):
    monkeypatch.setenv("CACHE_DB_PATH", "/data/prueba.sqlite3")
    assert config.Settings().cache_db_path == "/data/prueba.sqlite3"
