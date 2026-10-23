"""Métricas de calidad reales: definiciones, detalle de ingesta y script."""
import importlib.util
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.errores import FuenteNoDisponible
from app.metricas.calidad import (
    calcular_metricas_calidad,
    desglose_duplicados,
    fallas_de_la_fuente,
    porcentaje,
)
from app.repositories.cache import (
    DetalleIngesta,
    EjecucionRegistrada,
    RepositorioCache,
)
from app.schemas.ingesta import ResumenIngesta
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import payload

pytestmark = pytest.mark.recuperacion

AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
GALLETAS, LACTEOS = "en:biscuits", "en:dairies"


def resumen(recuperados, validos, duplicados=0, estado="completado",
            errores=0, inicio=AHORA):
    return ResumenIngesta(
        run_id=uuid.uuid4(), inicio=inicio,
        fin=None if estado == "en_curso" else inicio,
        recuperados=recuperados, validos=validos,
        invalidos=recuperados - validos, duplicados=duplicados,
        errores=errores, estado=estado,
    )


def ejecucion(recuperados, validos, duplicados=0, *, detalle=None,
              estado="completado", fallas=0, errores=0):
    return EjecucionRegistrada(
        resumen=resumen(recuperados, validos, duplicados, estado, errores),
        detalle=detalle, fallas_registradas=fallas,
    )


# --- Definiciones (casos calculables a mano) --------------------------------


def test_metricas_con_numeros_calculables_a_mano():
    ejecuciones = [
        ejecucion(10, 8, 2, detalle=DetalleIngesta(con_ingredientes=9)),
        ejecucion(30, 24, 6, detalle=DetalleIngesta(con_ingredientes=27)),
        # Anterior al detalle: cuenta en válidos y duplicados, no en
        # cobertura.
        ejecucion(20, 10, 0),
        # En curso: no cuenta.
        ejecucion(100, 0, estado="en_curso"),
    ]
    productos = [
        (True, AHORA - timedelta(hours=2)),
        (True, AHORA - timedelta(hours=4)),
        (False, AHORA - timedelta(hours=6)),
    ]
    metricas = calcular_metricas_calidad(ejecuciones, productos, AHORA)
    # (8 + 24 + 10) / (10 + 30 + 20) = 42 / 60
    assert metricas.porcentaje_validos == 70.0
    # (2 + 6 + 0) / 42 = 19.047...
    assert metricas.porcentaje_duplicados == 19.05
    # (9 + 27) / (10 + 30) = 36 / 40
    assert metricas.cobertura_ingredientes == 90.0
    # (2 + 4 + 6) / 3; el inválido también está en la caché.
    assert metricas.antiguedad_promedio_horas == 4.0
    # Solo los válidos.
    assert metricas.total_productos == 2


def test_sin_ingestas_terminadas_devuelve_ceros():
    metricas = calcular_metricas_calidad(
        [ejecucion(50, 0, estado="en_curso")], [], AHORA
    )
    assert metricas.model_dump() == {
        "porcentaje_validos": 0.0, "porcentaje_duplicados": 0.0,
        "cobertura_ingredientes": 0.0, "antiguedad_promedio_horas": 0.0,
        "total_productos": 0,
    }


def test_sin_ingestas_la_cache_igual_se_mide():
    metricas = calcular_metricas_calidad(
        [], [(True, AHORA - timedelta(hours=3))], AHORA
    )
    assert metricas.porcentaje_validos == 0.0
    assert metricas.antiguedad_promedio_horas == 3.0
    assert metricas.total_productos == 1


@pytest.mark.parametrize(
    "parte, total, esperado",
    [(1, 3, 33.33), (2, 3, 66.67), (0, 5, 0.0), (5, 0, 0.0), (4, 4, 100.0)],
)
def test_porcentaje(parte, total, esperado):
    assert porcentaje(parte, total) == esperado


def test_desglose_duplicados_suma_los_dos_tipos():
    ejecuciones = [
        ejecucion(10, 10, 4, detalle=DetalleIngesta(
            repetidos_en_ejecucion=1, existentes_sin_cambios=3)),
        ejecucion(5, 5, 2, detalle=DetalleIngesta(
            repetidos_en_ejecucion=2, existentes_sin_cambios=0)),
        ejecucion(5, 5, 5),  # sin detalle: no se puede desglosar
    ]
    desglose = desglose_duplicados(ejecuciones)
    assert (desglose.repetidos_en_ejecucion,
            desglose.existentes_sin_cambios, desglose.total) == (3, 3, 6)


def test_fallas_de_la_fuente():
    # 20 peticiones; 2 categorías fallaron en la primera ronda: 1 se
    # recuperó y 1 se perdió (que además falló en el reintento).
    con_detalle = ejecucion(
        30, 30, errores=1, fallas=3,
        detalle=DetalleIngesta(peticiones=20, fallas_recuperadas=1),
    )
    fallas = fallas_de_la_fuente(con_detalle)
    assert (fallas.peticiones, fallas.fallas, fallas.recuperadas,
            fallas.perdidas) == (20, 3, 1, 1)
    assert (fallas.primera_ronda, fallas.en_reintento) == (2, 1)
    assert fallas.tasa == 15.0
    assert fallas_de_la_fuente(ejecucion(5, 5)) is None


# --- Detalle que registra la ingesta ---------------------------------------


def paginas(lista, tamano=2):
    return [{"products": lista[i:i + tamano]}
            for i in range(0, len(lista), tamano)] or [{"products": []}]


def productos(desde, cantidad, categoria):
    return [payload(n, f"Producto {n}", "Harina de trigo, azúcar",
                    categories_tags=[categoria])
            for n in range(desde, desde + cantidad)]


def ingestar(client, **cuerpo):
    assert client.post("/ingest/runs", json=cuerpo).status_code == 202
    return ResumenIngesta.model_validate(
        client.get("/ingest/runs/latest").json()
    )


def test_duplicados_se_guardan_separados_por_tipo(client, off_falso,
                                                  repositorio):
    galletas = productos(1, 2, GALLETAS)
    off_falso.paginas_por_categoria = {GALLETAS: paginas(galletas)}
    ingestar(client, categorias=[GALLETAS], max_productos=2)

    # Segunda ingesta: las galletas ya están en la caché sin cambios, y la
    # primera vuelve a llegar dentro de lácteos.
    off_falso.paginas_por_categoria[LACTEOS] = paginas(
        [galletas[0], *productos(11, 2, LACTEOS)]
    )
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)

    assert (final.recuperados, final.validos, final.duplicados) == (5, 5, 3)
    detalle = repositorio.obtener_detalle(final.run_id)
    assert detalle.existentes_sin_cambios == 2
    assert detalle.repetidos_en_ejecucion == 1
    # El campo del contrato es la suma de ambos.
    assert final.duplicados == (detalle.existentes_sin_cambios
                                + detalle.repetidos_en_ejecucion)


def test_registra_cobertura_y_motivos_de_invalidez(client, off_falso,
                                                   repositorio):
    lote = [
        payload(1, "Galletas de avena", "Harina, avena"),
        {**payload(2, "Sin texto", "x"), "ingredients_text_es": None},
        payload(3, "Texto vacío", "Ingredientes: (30%)."),
        {**payload(4, "Código corto", "Agua, sal"), "code": "12"},
        {**payload(5, "Dígito malo", "Agua, sal"), "code": "7802920000016"},
        {**payload(6, "x", "Leche, azúcar"), "product_name_es": None},
    ]
    off_falso.paginas = paginas(lote)
    final = ingestar(client, max_productos=10)

    assert (final.recuperados, final.validos, final.invalidos) == (6, 1, 5)
    detalle = repositorio.obtener_detalle(final.run_id)
    # Con al menos un ingrediente tras limpiar: 1, 4, 5 y 6.
    assert detalle.con_ingredientes == 4
    assert detalle.motivos_invalidez == {
        "sin_ingredientes": 1,
        "ingredientes_vacios": 1,
        "codigo_barras_invalido": 1,
        "codigo_barras_digito_verificador_invalido": 1,
        "sin_nombre": 1,
    }
    # 3 páginas con productos + 1 vacía que confirma el final.
    assert detalle.peticiones == 4

    metricas = client.get("/metrics/quality")
    assert metricas.status_code == 200
    assert "X-Stub" not in metricas.headers
    assert metricas.json() == {
        "porcentaje_validos": 16.67,      # 1 / 6
        "porcentaje_duplicados": 0.0,     # 0 / 1
        "cobertura_ingredientes": 66.67,  # 4 / 6
        "antiguedad_promedio_horas": pytest.approx(0, abs=0.01),
        "total_productos": 1,             # solo se guardan los válidos
    }


def test_registra_peticiones_y_fallas_recuperadas(client, off_falso,
                                                  repositorio):
    off_falso.paginas_por_categoria = {
        GALLETAS: [[FuenteNoDisponible("HTTP 503"),
                    {"products": productos(1, 2, GALLETAS)}]],
        LACTEOS: paginas(productos(11, 2, LACTEOS)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)
    ejecucion_, = repositorio.listar_ejecuciones_terminadas()
    fallas = fallas_de_la_fuente(ejecucion_)
    # Galletas (falla), lácteos y el reintento de galletas.
    assert (fallas.peticiones, fallas.fallas) == (3, 1)
    assert (fallas.recuperadas, fallas.perdidas) == (1, 0)
    assert fallas.tasa == 33.33
    assert final.errores == 0


def test_metricas_sin_ingestas_responden_ceros(client):
    response = client.get("/metrics/quality")
    assert response.status_code == 200
    assert "X-Stub" not in response.headers
    assert response.json() == {
        "porcentaje_validos": 0.0, "porcentaje_duplicados": 0.0,
        "cobertura_ingredientes": 0.0, "antiguedad_promedio_horas": 0.0,
        "total_productos": 0,
    }


# --- Caché ------------------------------------------------------------------


@pytest.fixture
def repo(tmp_path):
    repositorio = RepositorioCache(str(tmp_path / "cache.sqlite3"))
    repositorio.inicializar()
    return repositorio


def test_detalle_se_guarda_y_se_conserva(repo):
    base = resumen(10, 8, 2)
    detalle = DetalleIngesta(
        repetidos_en_ejecucion=1, existentes_sin_cambios=1,
        con_ingredientes=9, peticiones=4, fallas_recuperadas=1,
        motivos_invalidez={"sin_nombre": 2},
    )
    repo.guardar_ejecucion(base, detalle)
    assert repo.obtener_detalle(base.run_id) == detalle
    # Actualizar el resumen sin detalle no lo borra.
    repo.guardar_ejecucion(base)
    assert repo.obtener_detalle(base.run_id) == detalle
    repo.registrar_error_fuente("SOURCE_UNAVAILABLE", "x", base.run_id)
    registrada, = repo.listar_ejecuciones_terminadas()
    assert registrada.resumen == base
    assert registrada.detalle == detalle
    assert registrada.fallas_registradas == 1


def test_migra_tabla_de_ejecuciones_antigua(tmp_path):
    ruta = str(tmp_path / "vieja.sqlite3")
    con = sqlite3.connect(ruta)
    con.executescript("""
        CREATE TABLE ejecuciones_ingesta (
            run_id TEXT PRIMARY KEY, inicio TEXT NOT NULL, fin TEXT,
            duracion_ms INTEGER, recuperados INTEGER NOT NULL,
            validos INTEGER NOT NULL, invalidos INTEGER NOT NULL,
            duplicados INTEGER NOT NULL, errores INTEGER NOT NULL,
            estado TEXT NOT NULL
        );
        INSERT INTO ejecuciones_ingesta VALUES (
            '3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b',
            '2026-10-21T12:00:00.000000Z', '2026-10-21T12:05:00.000000Z',
            300000, 237, 188, 49, 0, 4, 'completado_con_errores'
        );
    """)
    con.close()
    repo = RepositorioCache(ruta)
    repo.inicializar()
    vieja, = repo.listar_ejecuciones_terminadas()
    assert vieja.resumen.recuperados == 237
    assert vieja.detalle is None  # no se inventa lo que no se registró


def test_cache_sin_codigos_repetidos_y_estado_de_productos(repo):
    p = payload(1, "Galletas", "Harina")
    producto = mapear_producto(p, run_id=uuid.uuid4(), recuperado_en=AHORA,
                               base_url="https://x.org")
    repo.guardar_producto(producto, p, AHORA)
    # Volver a guardarlo (otra ingesta) no crea una segunda fila.
    repo.guardar_producto(producto, p, AHORA + timedelta(hours=1))
    assert repo.codigos_repetidos() == []
    assert repo.estado_productos() == [(True, AHORA + timedelta(hours=1))]


# --- Script de estadísticas -------------------------------------------------


RUTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "estadisticas_corpus.py"
)
_spec = importlib.util.spec_from_file_location("estadisticas_corpus_b5",
                                               RUTA_SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


def test_script_muestra_calidad_deduplicacion_y_fallas(repo, capsys):
    p = payload(1, "Galletas de avena", "Harina, avena",
                categories_tags=[GALLETAS])
    producto = mapear_producto(p, run_id=uuid.uuid4(), recuperado_en=AHORA,
                               base_url="https://x.org")
    repo.guardar_producto(producto, p)
    vieja = resumen(20, 10, inicio=AHORA - timedelta(days=1))
    repo.guardar_ejecucion(vieja)  # anterior al detalle
    ultima = resumen(12, 10, duplicados=4, errores=1)
    repo.guardar_ejecucion(ultima, DetalleIngesta(
        repetidos_en_ejecucion=1, existentes_sin_cambios=3,
        con_ingredientes=11, peticiones=10, fallas_recuperadas=1,
        motivos_invalidez={"sin_ingredientes": 1, "sin_nombre": 1},
    ))
    for mensaje in ("categoría a, página 1", "categoría b, página 1",
                    "reintento, categoría b, página 1"):
        repo.registrar_error_fuente("SOURCE_UNAVAILABLE", mensaje,
                                    ultima.run_id)

    assert script.main(["--db", repo.ruta, "--categorias", GALLETAS]) == 0
    salida = capsys.readouterr().out
    assert "2 ingestas terminadas" in salida
    assert "  repetidos en la misma ingesta: 1" in salida
    assert "  ya estaban en la caché sin cambios: 3" in salida
    assert "  códigos de barras repetidos: 0 (OK)" in salida
    assert f"Última ingesta ({ultima.run_id}, completado):" in salida
    assert "  duplicados: 1 repetidos en la ingesta + 3 ya en la caché" \
        in salida
    assert "  con ingredientes utilizables: 11 de 12 (91.67 %)" in salida
    assert "  fallas de la fuente: 3 de 10 peticiones (30.0 %)" in salida
    assert ("    primera ronda: 2 (1 recuperadas en el reintento, "
            "1 perdidas)") in salida
    assert "    en el reintento: 1" in salida


def test_script_con_ingesta_anterior_al_detalle(repo, capsys):
    repo.guardar_ejecucion(resumen(237, 188, errores=4,
                                   estado="completado_con_errores"))
    assert script.main(["--db", repo.ruta]) == 0
    assert "sin desglose ni tasa de fallas" in capsys.readouterr().out
