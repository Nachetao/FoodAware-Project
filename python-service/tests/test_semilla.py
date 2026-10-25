"""Semilla del corpus: exportación, carga al iniciar y archivo versionado."""
import gzip
import importlib.util
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.main import app
from app.metricas.calidad import calcular_metricas_calidad
from app.procesamiento import VERSION_PROCESAMIENTO
from app.repositories.cache import (
    DetalleIngesta,
    ErrorFuente,
    RepositorioCache,
)
from app.schemas.ingesta import ResumenIngesta
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


RUN_ANTIGUO = uuid.UUID("0b8e7f6a-1c2d-4e3f-9a8b-7c6d5e4f3a2b")
RUN_EN_CURSO = uuid.UUID("9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f")
FALLA = datetime(2026, 10, 1, 9, 31, tzinfo=timezone.utc)
DETALLE = DetalleIngesta(
    repetidos_en_ejecucion=1, existentes_sin_cambios=0, con_ingredientes=2,
    peticiones=4, fallas_recuperadas=1,
    motivos_invalidez={"sin_ingredientes": 1},
)


def resumen(run_id, inicio, **cambios):
    datos = dict(run_id=run_id, inicio=inicio,
                 fin=inicio + timedelta(minutes=3), duracion_ms=180000,
                 recuperados=3, validos=2, invalidos=1, duplicados=1,
                 errores=0, estado="completado_con_errores")
    datos.update(cambios)
    return ResumenIngesta(**datos)


@pytest.fixture
def origen(tmp_path):
    """Caché con un producto válido procesado con reglas viejas, otro al
    día y uno inválido; una ingesta con detalle y dos fallas de la fuente,
    otra anterior sin detalle y una en curso."""
    repo = nuevo_repo(tmp_path, "origen.sqlite3")
    viejo = mapear(LECHE).model_copy(update={
        "ingredientes": ["_leche_ entera", "vitamina a", "vitamina d3."],
        "alergenos": [],
        "calidad": Calidad(es_valido=True, problemas=[], completitud=1.0),
    })
    repo.guardar_producto(viejo, LECHE, VERIFICADO, version=0)
    repo.guardar_producto(mapear(GALLETAS), GALLETAS, VERIFICADO)
    repo.guardar_producto(mapear(INCOMPLETO), INCOMPLETO, VERIFICADO)
    repo.guardar_ejecucion(resumen(RUN_ID, RECUPERADO), DETALLE)
    repo.registrar_error_fuente("SOURCE_UNAVAILABLE", "categoría en:dairies, "
                                "página 1", run_id=RUN_ID, fecha=FALLA)
    repo.registrar_error_fuente("SOURCE_UNAVAILABLE", "reintento, categoría "
                                "en:dairies, página 1", run_id=RUN_ID,
                                fecha=FALLA + timedelta(minutes=1))
    repo.guardar_ejecucion(resumen(
        RUN_ANTIGUO, RECUPERADO - timedelta(days=1), recuperados=4,
        validos=2, invalidos=2, duplicados=0, estado="completado",
    ))
    repo.guardar_ejecucion(ResumenIngesta(
        run_id=RUN_EN_CURSO, inicio=VERIFICADO, recuperados=0, validos=0,
        invalidos=0, duplicados=0, errores=0, estado="en_curso",
    ))
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

    cargada = semilla.cargar_semilla_si_vacia(destino, BASE, archivo)

    assert cargada == semilla.ResumenSemilla(total=2, cargados=2, errores=0,
                                             ejecuciones=2)
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

    cargada = semilla.cargar_semilla(destino, BASE, archivo)

    assert cargada == semilla.ResumenSemilla(total=4, cargados=2, errores=2,
                                             ejecuciones=2)


def test_exporta_las_ejecuciones_terminadas_con_detalle_y_fallas(archivo):
    ejecuciones = json.loads(gzip.decompress(archivo.read_bytes()))[
        "ejecuciones"]

    # Por inicio; la que está en curso no se exporta.
    assert [e["resumen"]["run_id"] for e in ejecuciones] == [
        str(RUN_ANTIGUO), str(RUN_ID)]
    antigua, reciente = ejecuciones
    assert antigua["detalle"] is None
    assert antigua["fallas"] == []
    assert reciente["resumen"] == {
        "run_id": str(RUN_ID), "inicio": "2026-10-01T09:30:00Z",
        "fin": "2026-10-01T09:33:00Z", "duracion_ms": 180000,
        "recuperados": 3, "validos": 2, "invalidos": 1, "duplicados": 1,
        "errores": 0, "estado": "completado_con_errores",
    }
    assert reciente["detalle"] == {
        "repetidos_en_ejecucion": 1, "existentes_sin_cambios": 0,
        "con_ingredientes": 2, "peticiones": 4, "fallas_recuperadas": 1,
        "motivos_invalidez": {"sin_ingredientes": 1},
    }
    assert [f["mensaje"] for f in reciente["fallas"]] == [
        "categoría en:dairies, página 1",
        "reintento, categoría en:dairies, página 1",
    ]
    assert reciente["fallas"][0]["fecha"] == "2026-10-01T09:31:00Z"


def test_importa_las_ejecuciones_marcadas_como_semilla(archivo, origen,
                                                       tmp_path):
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    semilla.cargar_semilla_si_vacia(destino, BASE, archivo)

    importadas = destino.listar_ejecuciones_terminadas()
    assert [e.resumen.origen for e in importadas] == ["semilla", "semilla"]
    # Mismos conteos, detalle y fallas que en la caché de origen.
    esperadas = origen.listar_ejecuciones_terminadas()
    assert [e.resumen.model_dump(exclude={"origen"}) for e in importadas] == [
        e.resumen.model_dump(exclude={"origen"}) for e in esperadas]
    assert [e.detalle for e in importadas] == [None, DETALLE]
    assert [e.fallas_registradas for e in importadas] == [0, 2]
    assert destino.ultima_ejecucion().run_id == RUN_ID
    # Las métricas quedan iguales a las del corpus original.
    assert (calcular_metricas_calidad(importadas, [], VERIFICADO)
            == calcular_metricas_calidad(esperadas, [], VERIFICADO))


def test_no_pisa_una_ejecucion_que_ya_existe(archivo, tmp_path):
    destino = nuevo_repo(tmp_path, "destino.sqlite3")
    propia = resumen(RUN_ID, RECUPERADO, recuperados=50, validos=40,
                     invalidos=10, duplicados=0, estado="completado")
    destino.guardar_ejecucion(propia)

    cargada = semilla.cargar_semilla(destino, BASE, archivo)

    assert (cargada.ejecuciones, cargada.ejecuciones_omitidas) == (1, 1)
    assert destino.obtener_ejecucion(RUN_ID) == propia
    assert destino.listar_errores_fuente(run_id=RUN_ID) == []


def test_omite_las_ejecuciones_que_no_se_pueden_leer(archivo, tmp_path):
    contenido = json.loads(gzip.decompress(archivo.read_bytes()))
    ejecuciones = contenido["ejecuciones"]
    rota = json.loads(json.dumps(ejecuciones[1]))
    rota["resumen"]["run_id"] = str(uuid.uuid4())
    rota["resumen"]["validos"] = 99  # más válidos que recuperados
    sin_resumen = {"detalle": None}
    en_curso = json.loads(json.dumps(ejecuciones[0]))
    en_curso["resumen"].update(run_id=str(uuid.uuid4()), estado="en_curso",
                               fin=None)
    ejecuciones.extend([rota, sin_resumen, en_curso])
    archivo.write_bytes(gzip.compress(json.dumps(contenido).encode()))
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    cargada = semilla.cargar_semilla(destino, BASE, archivo)

    assert (cargada.ejecuciones, cargada.ejecuciones_omitidas) == (2, 3)
    assert len(destino.listar_ejecuciones_terminadas()) == 2


def test_una_semilla_sin_ejecuciones_se_sigue_cargando(archivo, tmp_path):
    contenido = json.loads(gzip.decompress(archivo.read_bytes()))
    del contenido["ejecuciones"]
    archivo.write_bytes(gzip.compress(json.dumps(contenido).encode()))
    destino = nuevo_repo(tmp_path, "destino.sqlite3")

    cargada = semilla.cargar_semilla_si_vacia(destino, BASE, archivo)

    assert cargada == semilla.ResumenSemilla(total=2, cargados=2, errores=0)
    assert destino.ultima_ejecucion() is None


def test_las_consultas_del_servicio_pueden_excluir_la_semilla(tmp_path):
    repo = nuevo_repo(tmp_path, "cache.sqlite3")
    repo.importar_ejecucion(
        resumen(RUN_ID, VERIFICADO, origen="semilla"), DETALLE,
        [ErrorFuente(FALLA, RUN_ID, "SOURCE_UNAVAILABLE", "x")],
    )

    assert repo.ultima_ejecucion().run_id == RUN_ID
    assert repo.ultima_ejecucion(excluir_semilla=True) is None
    assert repo.ultima_ejecucion_terminada(excluir_semilla=True) is None
    assert len(repo.listar_errores_fuente()) == 1
    assert repo.listar_errores_fuente(excluir_semilla=True) == []

    propia = resumen(RUN_ANTIGUO, RECUPERADO, estado="completado")
    repo.guardar_ejecucion(propia)
    # La de la semilla es más reciente, pero no es de este servicio.
    assert repo.ultima_ejecucion().run_id == RUN_ID
    assert repo.ultima_ejecucion(excluir_semilla=True) == propia
    assert repo.ultima_ejecucion_terminada(excluir_semilla=True) == propia


def test_no_importa_ejecuciones_en_curso(tmp_path):
    repo = nuevo_repo(tmp_path, "cache.sqlite3")
    en_curso = ResumenIngesta(
        run_id=RUN_EN_CURSO, inicio=VERIFICADO, recuperados=0, validos=0,
        invalidos=0, duplicados=0, errores=0, estado="en_curso",
    )

    with pytest.raises(ValueError):
        repo.importar_ejecucion(en_curso, None, [])


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
        calidad = cliente.get("/metrics/quality").json()
        ultima = cliente.get("/ingest/runs/latest").json()

    assert LECHE["code"] in [r["producto"]["codigo_barras"]
                             for r in busqueda["resultados"]]
    assert salud["detalle"]["cache"]["productos"] == 2
    assert salud["detalle"]["indice"]["productos"] == 2
    # Las métricas salen de las ingestas de la semilla: (2 + 2) / (3 + 4)
    # válidos, 1 / 4 duplicados y 2 / 3 con ingredientes (solo la que
    # tiene detalle).
    assert calidad["porcentaje_validos"] == 57.14
    assert calidad["porcentaje_duplicados"] == 25.0
    assert calidad["cobertura_ingredientes"] == 66.67
    assert ultima["run_id"] == str(RUN_ID)
    assert ultima["origen"] == "semilla"
    # Este servicio no consultó Open Food Facts: la semilla no cuenta como
    # ingesta propia en /health ni en estado_fuente.
    assert salud["dependencias"]["openfoodfacts"] == "no_verificado"
    assert salud["detalle"]["openfoodfacts"]["ultima_ingesta"] is None
    assert salud["detalle"]["openfoodfacts"]["ultima_falla"] is None
    assert busqueda["estado_fuente"] == "cache"


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

    cargada = semilla.cargar_semilla(destino, BASE)

    assert cargada.total > 0
    assert cargada.errores == 0
    assert cargada.cargados == cargada.total == destino.contar_productos()
    # Con las ingestas reales del corpus, las métricas no quedan en cero.
    assert cargada.ejecuciones == len(contenido["ejecuciones"]) > 0
    assert cargada.ejecuciones_omitidas == 0
    ejecuciones = destino.listar_ejecuciones_terminadas()
    assert {e.resumen.origen for e in ejecuciones} == {"semilla"}
    calidad = calcular_metricas_calidad(ejecuciones,
                                        destino.estado_productos(),
                                        datetime.now(timezone.utc))
    assert calidad.porcentaje_validos > 0
    assert calidad.cobertura_ingredientes > 0
    # Cada producto viene de una de esas ingestas.
    run_ids = {str(e.resumen.run_id) for e in ejecuciones}
    assert {str(p.procedencia.run_id)
            for p in destino.listar_productos()} <= run_ids
