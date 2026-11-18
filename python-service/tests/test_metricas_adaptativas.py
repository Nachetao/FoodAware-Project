"""GET /metrics/evaluation/adaptive, el script de reporte y el resultado
sobre el corpus real (la semilla) con el etiquetado revisado."""
import importlib.util
from pathlib import Path

import pytest

from app.evaluacion.adaptativa import PERFILES_PRUEBA
from app.repositories.cache import RepositorioCache
from app.schemas.metricas import MetricasEvaluacionAdaptativa
from app.services import semilla
from app.services.busqueda import ServicioBusqueda

pytestmark = pytest.mark.recuperacion

RUTA_SCRIPT = (Path(__file__).resolve().parents[1] / "scripts"
               / "evaluar_adaptativo.py")
_spec = importlib.util.spec_from_file_location("evaluar_adaptativo",
                                               RUTA_SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


@pytest.fixture(scope="module")
def busqueda_semilla(tmp_path_factory):
    """El índice de staging: la semilla del corpus."""
    repositorio = RepositorioCache(
        str(tmp_path_factory.mktemp("semilla") / "cache.sqlite3"))
    repositorio.inicializar()
    semilla.cargar_semilla(repositorio, "https://world.openfoodfacts.org")
    busqueda = ServicioBusqueda(repositorio)
    busqueda.reconstruir_ahora()
    return busqueda


def test_endpoint_responde_el_formato_del_contrato(client):
    response = client.get("/metrics/evaluation/adaptive")

    assert response.status_code == 200
    metricas = MetricasEvaluacionAdaptativa.model_validate(response.json())
    assert metricas.etiquetado.productos_revisados == 30
    # El índice de la prueba está vacío: nada que evaluar, sin errores.
    assert metricas.etiquetado.productos_evaluados == 0
    assert len(metricas.etiquetado.no_encontrados) == 30
    assert "asistencia de IA" in metricas.etiquetado.origen
    assert len(metricas.veredictos) == 2 * len(PERFILES_PRUEBA)
    assert len(metricas.busqueda.consultas) == 8


def test_en_el_corpus_real_ningun_perfil_tiene_falsos_apto(busqueda_semilla):
    """Protección: un cambio en las reglas que haga aparecer un falso "apto"
    sobre el etiquetado revisado debe fallar aquí."""
    resultado = busqueda_semilla.evaluacion_adaptativa

    assert resultado.evaluados == resultado.revisados == 30
    for perfil in resultado.perfiles:
        assert perfil.falsos_apto == (), (perfil.perfil, perfil.modo)
        assert perfil.falsos_apto_por_traza == (), (perfil.perfil,
                                                    perfil.modo)


def test_en_el_corpus_real_la_personalizada_no_muestra_no_aptos(
    busqueda_semilla
):
    resultado = busqueda_semilla.evaluacion_adaptativa

    assert len(resultado.consultas) == 8
    assert resultado.no_aptos_top_personalizado == 0
    assert resultado.no_aptos_top_base > 0
    assert resultado.precision_personalizada > resultado.precision_base


def test_el_script_genera_el_reporte(tmp_path, capsys):
    salida = tmp_path / "reporte.md"

    assert script.main(["--semilla", "--markdown", str(salida)]) == 0

    texto = salida.read_text(encoding="utf-8")
    for titulo in ("# Evaluación de la capacidad adaptativa",
                   "## Veredictos contra el etiquetado manual",
                   "## Matrices de confusión",
                   "## Detección de alérgenos contra el etiquetado",
                   "## Búsqueda base contra personalizada (top 5)",
                   "## Cómo leer estos resultados"):
        assert titulo in texto
    assert "asistencia de IA" in texto
    assert "| chocolate sin leche |" in texto
    assert texto in capsys.readouterr().out


def test_el_script_sin_cache_termina_con_error(tmp_path):
    assert script.main(["--db", str(tmp_path / "no-existe.sqlite3")]) == 2
