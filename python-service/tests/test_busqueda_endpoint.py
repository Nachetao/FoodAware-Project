"""GET /search con BM25: orden, paginación, metadatos e índice en memoria."""
import asyncio
import threading
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.main import app
from app.repositories.cache import RepositorioCache
from app.schemas.busqueda import RespuestaBusqueda
from app.services.busqueda import ServicioBusqueda
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import payload

pytestmark = pytest.mark.recuperacion

BASE = "https://world.openfoodfacts.org"
AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


GALLETAS_AVENA = payload(1, "Galletas de avena",
                         "Harina de trigo, avena, azúcar, mantequilla")
PAN_CON_AVENA = payload(2, "Pan de molde integral",
                        "Harina de trigo integral, agua, avena, sal, levadura")
GALLETAS_CHOCOLATE = payload(3, "Galletas de chocolate",
                             "Harina de trigo, azúcar, cacao",
                             categories="Snacks dulces")
BEBIDA_AVENA = payload(4, "Bebida de avena",
                       "Agua, avena, aceite de maravilla, sal",
                       marca="Vegetalia")
YOGUR = payload(5, "Yogur natural", "Leche, cultivos lácticos",
                marca="Colun")
CORPUS = [GALLETAS_AVENA, PAN_CON_AVENA, GALLETAS_CHOCOLATE, BEBIDA_AVENA,
          YOGUR]


def guardar(repositorio, *payloads):
    for p in payloads:
        producto = mapear_producto(p, run_id=uuid.uuid4(),
                                   recuperado_en=AHORA, base_url=BASE)
        repositorio.guardar_producto(producto, p)


@pytest.fixture
def corpus(repositorio, busqueda):
    guardar(repositorio, *CORPUS)
    busqueda.reconstruir_ahora()


def buscar(client, q, **params):
    response = client.get("/search", params={"q": q, **params})
    assert response.status_code == 200
    return RespuestaBusqueda.model_validate(response.json())


def codigos(respuesta):
    return [r.producto.codigo_barras for r in respuesta.resultados]


def test_galletas_de_avena_antes_que_pan_con_avena(client, corpus):
    respuesta = buscar(client, "galletas avena")
    orden = codigos(respuesta)
    assert orden[0] == GALLETAS_AVENA["code"]
    # El pan solo tiene avena en los ingredientes (peso 1): aparece, pero
    # después de todo lo que la tiene en el nombre (peso 3).
    assert orden.index(GALLETAS_AVENA["code"]) < orden.index(
        PAN_CON_AVENA["code"])
    assert orden.index(BEBIDA_AVENA["code"]) < orden.index(
        PAN_CON_AVENA["code"])
    assert YOGUR["code"] not in orden


def test_scores_descendentes_redondeados_y_positivos(client, corpus):
    respuesta = buscar(client, "galletas avena")
    scores = [r.score for r in respuesta.resultados]
    assert scores == sorted(scores, reverse=True)
    assert all(s > 0 and round(s, 4) == s for s in scores)
    assert respuesta.total == len(respuesta.resultados) == 4


def test_paginacion_con_posicion_global(client, corpus):
    completa = buscar(client, "avena")
    assert completa.total == 3
    assert [r.posicion for r in completa.resultados] == [1, 2, 3]

    pagina = buscar(client, "avena", limit=2, offset=1)
    assert pagina.total == 3
    assert [r.posicion for r in pagina.resultados] == [2, 3]
    assert codigos(pagina) == codigos(completa)[1:3]

    fuera = buscar(client, "avena", limit=10, offset=10)
    assert fuera.total == 3 and fuera.resultados == []


def test_metadatos_de_la_respuesta(client, corpus):
    respuesta = buscar(client, "Yogur")
    assert respuesta.consulta == "Yogur"
    assert isinstance(respuesta.tiempo_ms, float)
    assert respuesta.tiempo_ms >= 0
    assert respuesta.estado_fuente == "cache"  # aún no hay ingestas
    assert codigos(respuesta) == [YOGUR["code"]]


def test_categorias_del_payload_aportan_al_score(client, corpus):
    # "snack" solo aparece en las categorías de las galletas de chocolate.
    respuesta = buscar(client, "snacks")
    assert codigos(respuesta) == [GALLETAS_CHOCOLATE["code"]]
    assert respuesta.resultados[0].score > 0


@pytest.mark.parametrize("consulta", ["quinoa", "xyz", "de la", "y el"])
def test_sin_coincidencias_o_solo_stopwords(client, corpus, consulta):
    respuesta = buscar(client, consulta)
    assert respuesta.total == 0 and respuesta.resultados == []


def test_indice_vacio_responde_lista_vacia(client, busqueda):
    assert busqueda.instantanea.indice.vacio
    respuesta = buscar(client, "leche")
    assert respuesta.total == 0 and respuesta.resultados == []


def test_empate_por_completitud_y_luego_codigo(
    client, repositorio, busqueda
):
    base = dict(nombre="Galletas de miel", ingredientes="Harina, miel")
    # La incompleta tiene el código menor: si solo importara el código,
    # quedaría primera.
    sin_imagen = {**payload(1, **base), "image_front_url": None}
    completa_b = payload(3, **base)
    completa_a = payload(2, **base)
    guardar(repositorio, sin_imagen, completa_b, completa_a)
    busqueda.reconstruir_ahora()

    respuesta = buscar(client, "galletas miel")
    assert len({r.score for r in respuesta.resultados}) == 1  # empate
    assert codigos(respuesta) == [
        completa_a["code"], completa_b["code"], sin_imagen["code"]
    ]
    completitudes = [r.producto.calidad.completitud
                     for r in respuesta.resultados]
    assert completitudes == sorted(completitudes, reverse=True)


def test_se_reconstruye_al_terminar_una_ingesta(client, off_falso):
    assert buscar(client, "yogur").total == 0
    off_falso.paginas = [{"products": [YOGUR]}]
    response = client.post("/ingest/runs", json={"max_productos": 1})
    assert response.status_code == 202
    # La ingesta corre en segundo plano y al terminar reconstruye el índice.
    assert codigos(buscar(client, "yogur")) == [YOGUR["code"]]


def test_al_iniciar_se_construye_desde_la_cache(tmp_path, monkeypatch):
    ruta = str(tmp_path / "cache.sqlite3")
    repositorio = RepositorioCache(ruta)
    repositorio.inicializar()
    guardar(repositorio, *CORPUS)
    monkeypatch.setattr(config.settings, "cache_db_path", ruta)
    monkeypatch.setattr(config.settings, "off_user_agent", None)

    with TestClient(app) as cliente:
        assert app.state.busqueda.instantanea.indice.n_documentos == 5
        datos = cliente.get("/search", params={"q": "yogur"}).json()

    assert datos["total"] == 1


class RepositorioLento:
    """Repositorio falso cuya lectura se queda esperando una señal."""

    def __init__(self, registros):
        self.registros = registros
        self.leyendo = threading.Event()
        self.continuar = threading.Event()

    def listar_productos_con_payload(self):
        self.leyendo.set()
        assert self.continuar.wait(timeout=5)
        return self.registros

    def ultima_ejecucion_terminada(self):
        return None


def registros(*payloads):
    return [
        (mapear_producto(p, run_id=uuid.uuid4(), recuperado_en=AHORA,
                         base_url=BASE), p)
        for p in payloads
    ]


def test_reemplazo_seguro_del_indice():
    repo = RepositorioLento(registros(YOGUR))
    servicio = ServicioBusqueda(repo)
    repo.continuar.set()
    servicio.reconstruir_ahora()
    anterior = servicio.instantanea

    # Una reconstrucción lenta con datos nuevos...
    repo.registros = registros(YOGUR, GALLETAS_AVENA)
    repo.leyendo.clear()
    repo.continuar.clear()
    hilo = threading.Thread(target=servicio.reconstruir_ahora)
    hilo.start()
    assert repo.leyendo.wait(timeout=5)

    # ...mientras tanto las búsquedas siguen respondiendo con el anterior.
    durante = asyncio.run(servicio.buscar("galletas", 10, 0))
    assert durante.total == 0
    assert asyncio.run(servicio.buscar("yogur", 10, 0)).total == 1
    assert servicio.instantanea is anterior

    repo.continuar.set()
    hilo.join(timeout=5)
    assert asyncio.run(servicio.buscar("galletas", 10, 0)).total == 1
    # La instantánea anterior no cambió: quien la tenía sigue consistente.
    total, _ = anterior.buscar("galletas", 10, 0)
    assert total == 0
