"""Evaluación de la búsqueda: métricas, conjunto, evaluador y script."""
import importlib.util
import itertools
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.busqueda.buscador import Instantanea
from app.evaluacion import linea_base
from app.evaluacion.conjunto import (
    Regla,
    cargar_conjunto,
    conjunto_desde_dict,
    relevantes,
)
from app.evaluacion.evaluador import (
    K_POR_DEFECTO,
    evaluar,
    evaluar_instantanea,
)
from app.evaluacion.metricas import (
    precision_at_k,
    promedio_macro,
    recall_at_k,
)
from app.repositories.cache import RepositorioCache
from app.schemas.enums import AllergenCode
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import payload

pytestmark = pytest.mark.recuperacion

AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


# --- Métricas ---------------------------------------------------------------


def test_ejemplo_del_docstring():
    resultados = ["a", "b", "c", "d", "e"]
    relevantes_ = {"a", "c", "x", "y"}
    assert precision_at_k(resultados, relevantes_, 5) == 0.4
    assert recall_at_k(resultados, relevantes_, 5) == 0.5


def test_solo_cuentan_los_primeros_k():
    resultados = ["x", "a", "b", "c"]
    assert precision_at_k(resultados, {"c"}, 3) == 0.0
    assert precision_at_k(resultados, {"c"}, 4) == 0.25


def test_precision_divide_por_k_aunque_haya_menos_resultados():
    # 1 acierto con un solo resultado: 1/5, no 1/1.
    assert precision_at_k(["a"], {"a"}, 5) == 0.2
    assert recall_at_k(["a"], {"a"}, 5) == 1.0


def test_maximos_segun_cantidad_de_relevantes():
    # 2 relevantes y K = 5: P@5 no puede pasar de 2/5.
    assert precision_at_k(["a", "b", "x", "y", "z"], {"a", "b"}, 5) == 0.4
    # 10 relevantes y K = 5: R@5 no puede pasar de 5/10.
    todos = [str(i) for i in range(10)]
    assert recall_at_k(todos, set(todos), 5) == 0.5


def test_sin_relevantes_el_recall_no_esta_definido():
    assert recall_at_k(["a"], set(), 5) is None
    assert precision_at_k(["a"], set(), 5) == 0.0


def test_k_invalido():
    with pytest.raises(ValueError):
        precision_at_k(["a"], {"a"}, 0)


def test_promedio_macro():
    assert promedio_macro([1.0, 0.0, 0.5]) == 0.5
    assert promedio_macro([]) == 0.0


# --- Conjunto de evaluación -------------------------------------------------


def test_conjunto_versionado_con_al_menos_15_consultas_de_dos_tipos():
    conjunto = cargar_conjunto()
    assert conjunto.version >= 1
    assert len(conjunto.consultas) >= 15
    tipos = {c.tipo for c in conjunto.consultas}
    assert tipos == {"producto", "restriccion"}
    # Las de restricción dicen "sin" en la consulta.
    assert all(" sin " in f" {c.consulta} " for c in conjunto.consultas
               if c.tipo == "restriccion")


def consulta_dict(**cambios):
    datos = {"id": "q", "consulta": "galletas", "tipo": "producto",
             "relevancia": {"nombre_alguno": ["galleta"]}}
    datos.update(cambios)
    return datos


@pytest.mark.parametrize(
    "consultas",
    [
        [consulta_dict(tipo="otro")],
        [consulta_dict(consulta=" ")],
        [consulta_dict(relevancia={})],
        [consulta_dict(relevancia={"nombre_parecido": ["x"]})],
        [consulta_dict(relevancia={"sin_alergenos": ["gluten_x"]})],
        [consulta_dict(), consulta_dict()],  # id repetido
    ],
)
def test_conjunto_invalido_falla_al_cargar(consultas):
    with pytest.raises(ValueError):
        conjunto_desde_dict({"version": 1, "consultas": consultas})


def producto(n, nombre, ingredientes, categorias=(), **extra):
    p = payload(n, nombre, ingredientes, categories_tags=list(categorias),
                **extra)
    return (mapear_producto(p, run_id=uuid.uuid4(), recuperado_en=AHORA,
                            base_url="https://x.org"), p)


def test_regla_por_categoria_y_nombre_normalizado():
    avena, = [producto(1, "AVENA Instantanea", "Avena",
                       ["en:breakfast-cereals"])]
    regla = Regla(categorias_alguna=("en:breakfast-cereals",),
                  nombre_todos=("avena instantánea",))
    assert regla.es_relevante(*avena)
    assert not Regla(categorias_alguna=("en:breads",)).es_relevante(*avena)
    # Palabras completas: "pan" no está en "panadería".
    panaderia = producto(2, "Panadería del barrio", "Harina")
    assert not Regla(nombre_alguno=("pan",)).es_relevante(*panaderia)
    assert Regla(nombre_alguno=("panaderia",)).es_relevante(*panaderia)


def test_regla_sin_alergenos_excluye_tambien_las_trazas():
    con_trazas = producto(1, "Galleta", "Harina de arroz. Puede contener "
                          "maní.")
    sin_nada = producto(2, "Galleta", "Harina de arroz")
    regla = Regla(sin_alergenos=frozenset({AllergenCode.mani}))
    assert not regla.es_relevante(*con_trazas)
    assert regla.es_relevante(*sin_nada)


def test_regla_con_alergenos():
    leche = producto(1, "Leche", "Leche entera")
    regla = Regla(con_alergenos=frozenset({AllergenCode.lacteos}))
    assert regla.es_relevante(*leche)
    assert not regla.es_relevante(*producto(2, "Agua", "Agua"))


# --- Evaluador --------------------------------------------------------------

# Corpus fijo; cada número esperado se puede calcular a mano.
GALLETAS_AVENA = producto(1, "Galletas de avena", "Harina de trigo, avena",
                          ["en:biscuits"])
GALLETAS_ARROZ = producto(2, "Galletas de arroz", "Arroz, sal",
                          ["en:biscuits"])
PAN_AVENA = producto(3, "Pan de avena", "Harina de trigo, avena",
                     ["en:breads"])
GALLETAS_SIN_GLUTEN = producto(4, "Galletas sin gluten",
                               "Harina de arroz, azúcar", ["en:biscuits"])
CORPUS = [GALLETAS_AVENA, GALLETAS_ARROZ, PAN_AVENA, GALLETAS_SIN_GLUTEN]
CONJUNTO = conjunto_desde_dict({"version": 3, "consultas": [
    {"id": "avena", "consulta": "galletas de avena", "tipo": "producto",
     "relevancia": {"categorias_alguna": ["en:biscuits"],
                    "nombre_alguno": ["avena"]}},
    {"id": "sin-gluten", "consulta": "galletas sin gluten",
     "tipo": "restriccion",
     "relevancia": {"categorias_alguna": ["en:biscuits"],
                    "sin_alergenos": ["gluten"]}},
    {"id": "quinoa", "consulta": "quinoa", "tipo": "producto",
     "relevancia": {"nombre_alguno": ["quinoa"]}},
]})


def codigo(registro):
    return registro[0].codigo_barras


def test_relevantes_en_el_corpus():
    avena, sin_gluten, quinoa = CONJUNTO.consultas
    assert relevantes(avena.regla, CORPUS) == [codigo(GALLETAS_AVENA)]
    assert relevantes(sin_gluten.regla, CORPUS) == [
        codigo(GALLETAS_ARROZ), codigo(GALLETAS_SIN_GLUTEN)
    ]
    assert relevantes(quinoa.regla, CORPUS) == []


def test_evaluar_con_buscador_falso_y_reloj_fijo():
    respuestas = {
        "galletas de avena": [codigo(PAN_AVENA), codigo(GALLETAS_AVENA)],
        "galletas sin gluten": [codigo(GALLETAS_SIN_GLUTEN)],
        "quinoa": [],
    }
    llamadas = []

    def buscar(consulta, k):
        llamadas.append((consulta, k))
        return respuestas[consulta]

    # Cada búsqueda "tarda" 2 ms.
    tiempos = itertools.count(0, 0.001)
    resultado = evaluar(CONJUNTO, CORPUS, buscar, k=2,
                        reloj=lambda: next(tiempos))
    avena, sin_gluten, quinoa = resultado.por_consulta
    assert llamadas[0] == ("galletas de avena", 2)
    # 1 relevante en el top 2: P = 1/2, R = 1/1.
    assert (avena.aciertos, avena.precision, avena.recall) == (1, 0.5, 1.0)
    # 1 de 2 relevantes con un solo resultado: P = 1/2, R = 1/2.
    assert (sin_gluten.precision, sin_gluten.recall) == (0.5, 0.5)
    assert avena.tiempo_ms == pytest.approx(1.0)
    # Sin relevantes: excluida de los promedios e informada aparte.
    assert not quinoa.evaluada and quinoa.recall is None
    assert resultado.excluidas == [quinoa]
    global_ = resultado.promedio()
    assert global_.consultas == 2
    assert (global_.precision, global_.recall) == (0.5, 0.75)
    producto_ = resultado.promedio("producto")
    assert (producto_.consultas, producto_.recall) == (1, 1.0)
    assert resultado.promedio("restriccion").recall == 0.5
    assert resultado.version_conjunto == 3
    assert resultado.total_productos == 4


def test_evaluar_el_indice_bm25_real():
    resultado = evaluar_instantanea(CONJUNTO, CORPUS,
                                    Instantanea.construir(CORPUS))
    assert resultado.k == K_POR_DEFECTO == 5
    avena, sin_gluten, quinoa = resultado.por_consulta
    # "galletas de avena": las galletas de avena quedan primeras.
    assert avena.resultados[0] == codigo(GALLETAS_AVENA)
    assert (avena.precision, avena.recall) == (0.2, 1.0)
    # "galletas sin gluten": las 3 galletas aparecen (las 2 relevantes y
    # la de avena, que tiene gluten); el pan no tiene ningún término.
    assert set(sin_gluten.resultados) == {
        codigo(GALLETAS_AVENA), codigo(GALLETAS_ARROZ),
        codigo(GALLETAS_SIN_GLUTEN),
    }
    assert sin_gluten.resultados[0] == codigo(GALLETAS_SIN_GLUTEN)
    assert (sin_gluten.precision, sin_gluten.recall) == (0.4, 1.0)
    assert quinoa.resultados == () and not quinoa.evaluada
    assert resultado.promedio().precision == pytest.approx(0.3)


def test_evaluar_instantanea_ignora_productos_no_indexados():
    invalido = producto(9, "Galletas de avena rotas", "Harina, avena",
                        ["en:biscuits"], code="12345678901")
    resultado = evaluar_instantanea(CONJUNTO, [*CORPUS, invalido],
                                    Instantanea.construir(CORPUS))
    assert resultado.total_productos == 4
    assert resultado.por_consulta[0].relevantes == 1


# --- Script -----------------------------------------------------------------


RUTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "evaluar_busqueda.py"
)
_spec = importlib.util.spec_from_file_location("evaluar_busqueda",
                                               RUTA_SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


@pytest.fixture
def cache_con_corpus(tmp_path):
    repo = RepositorioCache(str(tmp_path / "cache.sqlite3"))
    repo.inicializar()
    for producto_, payload_ in CORPUS:
        repo.guardar_producto(producto_, payload_)
    return repo.ruta


def test_script_muestra_tabla_y_guarda_markdown(cache_con_corpus, tmp_path,
                                                capsys):
    consultas = tmp_path / "consultas.json"
    consultas.write_text(
        '{"version": 3, "consultas": ['
        '{"id": "avena", "consulta": "galletas de avena", "tipo": '
        '"producto", "relevancia": {"categorias_alguna": ["en:biscuits"], '
        '"nombre_alguno": ["avena"]}},'
        '{"id": "sin-gluten", "consulta": "galletas sin gluten", "tipo": '
        '"restriccion", "relevancia": {"categorias_alguna": '
        '["en:biscuits"], "sin_alergenos": ["gluten"]}},'
        '{"id": "quinoa", "consulta": "quinoa", "tipo": "producto", '
        '"relevancia": {"nombre_alguno": ["quinoa"]}}]}',
        encoding="utf-8",
    )
    destino = tmp_path / "reportes" / "evaluacion.md"
    assert script.main(["--db", cache_con_corpus, "--consultas",
                        str(consultas), "--markdown", str(destino)]) == 0
    salida = capsys.readouterr().out
    assert "| galletas de avena | Producto | 1 | 0.20 | 1.00 |" in salida
    assert "| galletas sin gluten | Restricción | 2 | 0.40 | 1.00 |" \
        in salida
    assert "| quinoa | Producto | 0 | — | — |" in salida
    assert "| Producto | 1 | 0.20 | 1.00 |" in salida
    assert "| Restricción | 1 | 0.40 | 1.00 |" in salida
    assert "| **Global** | 2 | 0.30 | 1.00 |" in salida
    assert "- quinoa (quinoa)" in salida
    assert "BM25 trata \"sin\" como una" in salida
    guardado = destino.read_text(encoding="utf-8")
    assert guardado.startswith("# Evaluación de la búsqueda (BM25)")
    assert "| galletas de avena | Producto |" in guardado


def test_script_k_configurable(cache_con_corpus, capsys):
    assert script.main(["--db", cache_con_corpus, "--k", "1"]) == 0
    salida = capsys.readouterr().out
    assert "- K = 1" in salida and "| P@1 | R@1 |" in salida


def test_linea_base_guardar_cargar_y_comparar(tmp_path):
    resultado = evaluar_instantanea(CONJUNTO, CORPUS,
                                    Instantanea.construir(CORPUS))
    ruta = tmp_path / "base.json"
    linea_base.guardar(ruta, resultado, "Prueba", "2026-10-21 12:00 UTC")
    base = linea_base.cargar(ruta)
    assert (base.k, base.version_conjunto, base.total_productos) == (5, 3, 4)
    assert base.consultas["sin-gluten"].aciertos == 2
    assert base.consultas["quinoa"].recall is None
    assert base.grupos["global"].precision == pytest.approx(0.3)
    assert base.motivo_no_comparable(resultado) is None
    otro_k = evaluar_instantanea(CONJUNTO, CORPUS,
                                 Instantanea.construir(CORPUS), k=3)
    assert "K = 5" in base.motivo_no_comparable(otro_k)


def test_linea_base_versionada_del_repositorio():
    # Resultado del Bloque 5, Parte 2 sobre la caché real, sin sinónimos.
    base = linea_base.cargar()
    conjunto = cargar_conjunto()
    assert (base.k, base.version_conjunto) == (5, conjunto.version)
    assert set(base.consultas) == {c.id for c in conjunto.consultas}
    assert round(base.grupos["global"].precision, 2) == 0.47


def test_script_compara_con_la_linea_base(cache_con_corpus, tmp_path,
                                          capsys):
    consultas = tmp_path / "consultas.json"
    consultas.write_text(json.dumps({"version": 3, "consultas": [
        {"id": "avena", "consulta": "galletas de avena", "tipo": "producto",
         "relevancia": {"categorias_alguna": ["en:biscuits"],
                        "nombre_alguno": ["avena"]}},
        {"id": "sin-gluten", "consulta": "galletas sin gluten",
         "tipo": "restriccion",
         "relevancia": {"categorias_alguna": ["en:biscuits"],
                        "sin_alergenos": ["gluten"]}},
    ]}), encoding="utf-8")
    base = tmp_path / "base.json"
    argumentos = ["--db", cache_con_corpus, "--consultas", str(consultas)]
    assert script.main([*argumentos, "--guardar-linea-base", str(base),
                        "--descripcion", "Antes"]) == 0
    capsys.readouterr()

    assert script.main([*argumentos, "--linea-base", str(base)]) == 0
    salida = capsys.readouterr().out
    assert "## Comparación con la línea base" in salida
    assert "Línea base: Antes (" in salida
    # Mismo índice: sin cambios.
    assert "| galletas de avena | 1 | 0.20 | 0.20 | = | 1.00 | 1.00 | = |" \
        in salida
    assert "| **Global** | 0.30 | 0.30 | = | 1.00 | 1.00 | = |" in salida

    assert script.main([*argumentos, "--linea-base", str(base),
                        "--k", "3"]) == 0
    assert "No es comparable: usa K = 5" in capsys.readouterr().out


def test_cambio_entre_linea_base_y_ahora():
    assert script._cambio(0.2, 0.6) == "+0.40"
    assert script._cambio(0.6, 0.2) == "-0.40"
    assert script._cambio(0.5, 0.5) == "="
    assert script._cambio(None, 0.5) == "—"


def test_script_errores(tmp_path, capsys):
    assert script.main(["--db", str(tmp_path / "no.sqlite3")]) == 2
    assert "no existe" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        script.main(["--db", str(tmp_path / "x"), "--k", "0"])
