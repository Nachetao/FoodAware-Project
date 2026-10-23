"""GET /metrics/evaluation y ausencia de stubs en el contrato."""
import uuid
from datetime import datetime, timezone

import pytest

import app.services.busqueda as modulo_busqueda
from app.evaluacion.conjunto import conjunto_desde_dict
from app.evaluacion.evaluador import evaluar
from app.main import app
from app.metricas.evaluacion import metricas_evaluacion
from app.schemas.metricas import MetricasEvaluacion
from app.services.busqueda import ServicioBusqueda
from app.services.ingesta import ServicioIngesta
from app.services.mapeo_off import mapear_producto
from app.services.metricas import ServicioMetricas
from tests.payloads_off import payload

pytestmark = pytest.mark.recuperacion

AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)

# Corpus y conjunto fijos (los mismos de tests/test_evaluacion.py):
# "galletas de avena" da P@5 = 1/5 y R@5 = 1/1; "galletas sin gluten",
# P@5 = 2/5 y R@5 = 2/2; "quinoa" no tiene relevantes y se excluye.
CORPUS = [
    payload(1, "Galletas de avena", "Harina de trigo, avena",
            categories_tags=["en:biscuits"]),
    payload(2, "Galletas de arroz", "Arroz, sal",
            categories_tags=["en:biscuits"]),
    payload(3, "Pan de avena", "Harina de trigo, avena",
            categories_tags=["en:breads"]),
    payload(4, "Galletas sin gluten", "Harina de arroz, azúcar",
            categories_tags=["en:biscuits"]),
]
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


@pytest.fixture
def busqueda(client, repositorio, off_falso):
    """Servicios de búsqueda y métricas con el conjunto de prueba."""
    servicio = ServicioBusqueda(repositorio, conjunto=CONJUNTO)
    app.state.busqueda = servicio
    app.state.metricas = ServicioMetricas(repositorio, servicio)
    app.state.ingesta = ServicioIngesta(
        repositorio, off_falso, "https://world.openfoodfacts.org",
        al_terminar=servicio.reconstruir, dormir=off_falso.dormir,
    )
    return servicio


def guardar_corpus(repositorio):
    for p in CORPUS:
        producto = mapear_producto(p, run_id=uuid.uuid4(),
                                   recuperado_en=AHORA,
                                   base_url="https://x.org")
        repositorio.guardar_producto(producto, p)


def test_evaluacion_con_indice_vacio(client, busqueda):
    response = client.get("/metrics/evaluation")
    assert response.status_code == 200
    assert "X-Stub" not in response.headers
    assert response.json() == {
        "k": 5, "precision_at_k": 0.0, "recall_at_k": 0.0,
        "consultas_evaluadas": 0, "tiempo_promedio_ms": 0.0,
    }


def test_evaluacion_del_indice_vigente(client, repositorio, busqueda):
    guardar_corpus(repositorio)
    busqueda.reconstruir_ahora()
    response = client.get("/metrics/evaluation")
    assert response.status_code == 200
    datos = MetricasEvaluacion.model_validate(response.json())
    assert datos.k == 5
    # Promedio macro de las 2 consultas con relevantes.
    assert datos.precision_at_k == 0.3   # (0.2 + 0.4) / 2
    assert datos.recall_at_k == 1.0      # (1.0 + 1.0) / 2
    assert datos.consultas_evaluadas == 2  # "quinoa" queda fuera
    assert datos.tiempo_promedio_ms >= 0


def test_no_evalua_en_cada_peticion(client, repositorio, busqueda,
                                    monkeypatch):
    llamadas = []
    original = modulo_busqueda.evaluar_instantanea

    def contando(*args, **kwargs):
        llamadas.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(modulo_busqueda, "evaluar_instantanea", contando)
    guardar_corpus(repositorio)
    busqueda.reconstruir_ahora()
    assert len(llamadas) == 1
    for _ in range(3):
        assert client.get("/metrics/evaluation").status_code == 200
    assert len(llamadas) == 1


def test_se_recalcula_al_terminar_una_ingesta(client, off_falso, busqueda):
    assert client.get("/metrics/evaluation").json()[
        "consultas_evaluadas"] == 0
    off_falso.paginas = [{"products": CORPUS}]
    response = client.post("/ingest/runs", json={"max_productos": 4})
    assert response.status_code == 202
    datos = client.get("/metrics/evaluation").json()
    assert datos["consultas_evaluadas"] == 2
    assert datos["precision_at_k"] == 0.3


def test_evaluacion_corresponde_al_indice_publicado(repositorio, busqueda):
    guardar_corpus(repositorio)
    indice = busqueda.reconstruir_ahora()
    # Se publican juntos: la evaluación es la del índice que responde.
    assert busqueda.instantanea is indice
    assert busqueda.evaluacion.total_productos == indice.indice.n_documentos


def test_conversion_al_contrato_redondea():
    registros = [
        (mapear_producto(p, run_id=uuid.uuid4(), recuperado_en=AHORA,
                         base_url="https://x.org"), p)
        for p in CORPUS
    ]
    avena, arroz = CORPUS[0]["code"], CORPUS[1]["code"]
    respuestas = {"galletas de avena": [avena],
                  "galletas sin gluten": [arroz], "quinoa": []}
    resultado = evaluar(
        CONJUNTO, registros, lambda consulta, k: respuestas[consulta], k=3,
        # Tiempos: 1.2345 ms, 2 ms y 0 ms (la última no se evalúa).
        reloj=iter([0.0, 0.0012345, 1.0, 1.002, 2.0, 2.0]).__next__,
    )
    # avena: P = 1/3, R = 1; sin gluten: P = 1/3, R = 1/2.
    assert metricas_evaluacion(resultado).model_dump() == {
        "k": 3,
        "precision_at_k": 0.3333,
        "recall_at_k": 0.75,
        "consultas_evaluadas": 2,
        "tiempo_promedio_ms": 1.617,  # (1.2345 + 2) / 2
    }


def test_servicio_real_usa_el_conjunto_versionado(client):
    datos = client.get("/metrics/evaluation").json()
    assert datos["k"] == 5
    assert set(datos) == {"k", "precision_at_k", "recall_at_k",
                          "consultas_evaluadas", "tiempo_promedio_ms"}


@pytest.mark.parametrize(
    "ruta",
    ["/", "/health", "/products/7800000000009", "/search?q=leche",
     "/ingest/runs/latest", "/metrics/quality", "/metrics/evaluation"],
)
def test_ningun_endpoint_es_stub(client, ruta):
    assert "X-Stub" not in client.get(ruta).headers
