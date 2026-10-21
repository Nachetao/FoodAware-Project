"""Cobertura del corpus: ingesta repartida por categorías y estadísticas."""
import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
import respx
from pydantic import ValidationError

from app.busqueda.estadisticas import calcular_estadisticas
from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core import config
from app.core.errores import FuenteNoDisponible
from app.main import solicitud_automatica
from app.repositories.cache import RepositorioCache
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.ingesta import ServicioIngesta, cuota_por_categoria
from app.services.mapeo_off import mapear_producto
from tests.payloads_off import payload

GALLETAS, LACTEOS, PANES = "en:biscuits", "en:dairies", "en:breads"
CATEGORIAS_POR_DEFECTO = [
    "en:biscuits", "en:dairies", "en:breads", "en:chocolates",
    "en:breakfast-cereals", "en:salty-snacks",
    "en:plant-based-milk-alternatives",
]
AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def productos(desde, cantidad, categoria):
    """`cantidad` payloads válidos con códigos desde `desde`."""
    return [
        payload(n, f"Producto {n}", "Harina de trigo, azúcar",
                categories_tags=[categoria])
        for n in range(desde, desde + cantidad)
    ]


def paginas(lista, tamano=2):
    """Divide en páginas de `tamano`, como /api/v2/search."""
    return [{"products": lista[i:i + tamano]}
            for i in range(0, len(lista), tamano)] or [{"products": []}]


def ingestar(client, **cuerpo):
    assert client.post("/ingest/runs", json=cuerpo).status_code == 202
    return ResumenIngesta.model_validate(
        client.get("/ingest/runs/latest").json()
    )


def busquedas(off_falso):
    """(categoría, página, tamaño) de cada búsqueda hecha a OFF."""
    return [(c[2][0] if c[2] else None, c[3], c[4])
            for c in off_falso.llamadas if c[0] == "busqueda"]


# --- Reparto del máximo -----------------------------------------------------


def test_cuota_reparte_500_entre_7_categorias():
    restante, cuotas = 500, []
    for quedan in range(7, 0, -1):
        cuota = cuota_por_categoria(restante, quedan)
        cuotas.append(cuota)
        restante -= cuota
    assert cuotas == [72, 72, 72, 71, 71, 71, 71]
    assert sum(cuotas) == 500


@pytest.mark.parametrize(
    "restante, quedan, esperado",
    [(6, 3, 2), (5, 2, 3), (1, 7, 1), (470, 6, 79)],
)
def test_cuota_por_categoria(restante, quedan, esperado):
    assert cuota_por_categoria(restante, quedan) == esperado


def test_reparte_el_maximo_entre_categorias(client, off_falso, repositorio):
    off_falso.paginas_por_categoria = {
        GALLETAS: paginas(productos(1, 5, GALLETAS)),
        LACTEOS: paginas(productos(11, 5, LACTEOS)),
        PANES: paginas(productos(21, 5, PANES)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS, PANES],
                     max_productos=6)
    assert final.estado == "completado"
    assert (final.recuperados, final.validos) == (6, 6)
    # Una búsqueda por categoría (no un OR), 2 productos cada una.
    assert busquedas(off_falso) == [
        (GALLETAS, 1, 2), (LACTEOS, 1, 2), (PANES, 1, 2),
    ]
    por_categoria = calcular_estadisticas(
        repositorio.listar_productos_con_payload(),
        [GALLETAS, LACTEOS, PANES],
    ).por_categoria
    assert por_categoria == {GALLETAS: 2, LACTEOS: 2, PANES: 2}


def test_lo_que_no_usa_una_categoria_pasa_a_las_siguientes(client,
                                                           off_falso):
    off_falso.paginas_por_categoria = {
        GALLETAS: paginas(productos(1, 1, GALLETAS)),  # solo hay 1
        LACTEOS: paginas(productos(11, 5, LACTEOS)),
        PANES: paginas(productos(21, 5, PANES)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS, PANES],
                     max_productos=6)
    assert final.recuperados == 6
    # Galletas trae 1; lácteos recibe ceil(5 / 2) = 3 (dos páginas) y
    # panes los 2 que quedan.
    assert busquedas(off_falso) == [
        (GALLETAS, 1, 2),
        (LACTEOS, 1, 2), (LACTEOS, 2, 2),
        (PANES, 1, 2),
    ]


def test_repetido_entre_categorias_cuenta_como_duplicado_sin_gastar_cuota(
    client, off_falso, repositorio
):
    compartido = payload(99, "Galleta de leche", "Harina, leche",
                         categories_tags=[GALLETAS, LACTEOS])
    off_falso.paginas_por_categoria = {
        GALLETAS: paginas([compartido, *productos(1, 3, GALLETAS)]),
        LACTEOS: paginas([compartido, *productos(11, 3, LACTEOS)]),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)
    # 4 productos distintos (2 por categoría) + la repetición en lácteos,
    # que suma a recuperados, validos y duplicados.
    assert (final.recuperados, final.validos, final.invalidos,
            final.duplicados) == (5, 5, 0, 1)
    assert repositorio.contar_productos() == 4
    # La repetición no gastó la cuota de lácteos: igual trajo 2 nuevos,
    # aunque para eso pidió una segunda página.
    assert busquedas(off_falso) == [
        (GALLETAS, 1, 2), (LACTEOS, 1, 2), (LACTEOS, 2, 2),
    ]
    assert final.estado == "completado"


def test_repetido_invalido_cuenta_como_invalido(client, off_falso):
    sin_ingredientes = {**payload(98, "Galleta rota", "x"),
                        "ingredients_text_es": None}
    off_falso.paginas_por_categoria = {
        GALLETAS: paginas([sin_ingredientes, *productos(1, 1, GALLETAS)]),
        LACTEOS: paginas([sin_ingredientes, *productos(11, 2, LACTEOS)]),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)
    # `duplicados` solo cuenta válidos: el inválido repetido es otro
    # inválido, no un duplicado.
    assert (final.recuperados, final.validos, final.invalidos,
            final.duplicados) == (5, 3, 2, 0)
    assert final.estado == "completado"


def test_conteo_consistente_con_duplicados_de_cache_y_repetidos(
    client, off_falso
):
    # El mismo producto en tres categorías y además ya guardado en la
    # caché: el primero es duplicado de la caché y los otros dos, repetidos.
    leche = payload(97, "Leche entera", "Leche entera",
                    categories_tags=[GALLETAS, LACTEOS, PANES])
    off_falso.paginas_por_categoria = {
        c: paginas([leche]) for c in (GALLETAS, LACTEOS, PANES)
    }
    ingestar(client, categorias=[LACTEOS], max_productos=1)

    final = ingestar(client, categorias=[GALLETAS, LACTEOS, PANES],
                     max_productos=6)

    # Se respetan las reglas de ResumenIngesta: si no, no se habría podido
    # guardar y la ejecución quedaría fallida.
    assert final.estado == "completado"
    assert (final.recuperados, final.validos, final.duplicados) == (3, 3, 3)
    assert final.validos + final.invalidos <= final.recuperados
    assert final.duplicados <= final.validos


def test_si_falla_una_categoria_sigue_con_las_demas(client, off_falso,
                                                    repositorio):
    off_falso.paginas_por_categoria = {
        GALLETAS: [FuenteNoDisponible("HTTP 503")],
        LACTEOS: paginas(productos(11, 5, LACTEOS)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)
    assert final.estado == "completado_con_errores"
    # La cuota de galletas (2) quedó reservada para su reintento, que
    # también falló: lácteos trae solo su parte.
    assert (final.recuperados, final.errores) == (2, 1)
    reintento, primera = repositorio.listar_errores_fuente(final.run_id)
    assert primera.mensaje.startswith(f"categoría {GALLETAS}, página 1:")
    assert reintento.mensaje.startswith(
        f"reintento, categoría {GALLETAS}, página 1:")


# --- Reintento de categorías que fallaron ----------------------------------


def test_categoria_que_falla_se_recupera_en_el_reintento(
    client, off_falso, repositorio
):
    off_falso.paginas_por_categoria = {
        # Página 1 de galletas: 503 la primera vez, bien la segunda.
        GALLETAS: [[FuenteNoDisponible("HTTP 503"),
                    {"products": productos(1, 2, GALLETAS)}]],
        LACTEOS: paginas(productos(11, 5, LACTEOS)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)

    # Se recuperó: no es un error del resumen y la ejecución termina bien.
    assert final.estado == "completado"
    assert (final.recuperados, final.validos, final.errores) == (4, 4, 0)
    # Pero la falla queda registrada.
    falla, = repositorio.listar_errores_fuente(final.run_id)
    assert falla.mensaje.startswith(f"categoría {GALLETAS}, página 1:")
    # Pausa antes del reintento y orden de las búsquedas.
    assert off_falso.pausas == [60.0]
    assert busquedas(off_falso) == [
        (GALLETAS, 1, 2), (LACTEOS, 1, 2), (GALLETAS, 1, 2),
    ]
    # La cuota reservada mantuvo el corpus parejo.
    por_categoria = calcular_estadisticas(
        repositorio.listar_productos_con_payload(), [GALLETAS, LACTEOS]
    ).por_categoria
    assert por_categoria == {GALLETAS: 2, LACTEOS: 2}


def test_reintento_sigue_desde_la_pagina_que_fallo(client, off_falso):
    off_falso.paginas_por_categoria = {
        GALLETAS: [
            {"products": productos(1, 2, GALLETAS)},
            [FuenteNoDisponible("HTTP 503"),
             {"products": productos(3, 2, GALLETAS)}],
        ],
        LACTEOS: paginas(productos(11, 5, LACTEOS)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=6)
    assert (final.recuperados, final.errores) == (6, 0)
    # Galletas: cuota 3, trae 2 y falla en la página 2 (1 reservado).
    # Lácteos: cuota 3. Reintento: galletas sigue en la página 2 con el
    # mismo tamaño de página, así no se salta ni repite productos.
    assert busquedas(off_falso) == [
        (GALLETAS, 1, 2), (GALLETAS, 2, 2),
        (LACTEOS, 1, 2), (LACTEOS, 2, 2),
        (GALLETAS, 2, 2),
    ]


def test_sin_fallas_no_hay_pausa_ni_reintento(client, off_falso):
    off_falso.paginas_por_categoria = {
        GALLETAS: paginas(productos(1, 2, GALLETAS)),
        LACTEOS: paginas(productos(11, 2, LACTEOS)),
    }
    final = ingestar(client, categorias=[GALLETAS, LACTEOS],
                     max_productos=4)
    assert final.estado == "completado"
    assert off_falso.pausas == []
    assert len(busquedas(off_falso)) == 2


def test_sin_categorias_hace_una_sola_busqueda_por_pais(client, off_falso):
    off_falso.paginas = paginas(productos(1, 3, GALLETAS))
    final = ingestar(client, max_productos=3)
    assert final.recuperados == 3
    assert [c for c, _, _ in busquedas(off_falso)] == [None, None]


# --- Limitador de búsquedas -------------------------------------------------


class LimitadorContador:
    def __init__(self):
        self.esperas_maximas = []

    async def esperar_turno(self, espera_maxima=None):
        self.esperas_maximas.append(espera_maxima)


@pytest.mark.anyio
async def test_cada_busqueda_por_categoria_pasa_por_el_limitador(tmp_path):
    base = "https://off.test"
    limitador = LimitadorContador()
    cliente = ClienteOpenFoodFacts(
        base, "FoodAware/0.1 (correo@ejemplo.com)",
        limitador_busquedas=limitador, limitador_lecturas=LimitadorContador(),
    )
    repo = RepositorioCache(str(tmp_path / "cache.sqlite3"))
    repo.inicializar()
    inicio = {GALLETAS: 1, LACTEOS: 11, PANES: 21}

    def responder(request):
        categoria = request.url.params["categories_tags"]
        return httpx.Response(200, json={
            "products": productos(inicio[categoria], 1, categoria)
        })

    solicitud = SolicitudIngesta(categorias=[GALLETAS, LACTEOS, PANES],
                                 max_productos=6)
    with respx.mock(base_url=base) as mock:
        ruta = mock.get("/api/v2/search").mock(side_effect=responder)
        servicio = ServicioIngesta(repo, cliente, base, tamano_pagina=2)
        resumen, _ = await servicio.iniciar(solicitud)
        final = await servicio.ejecutar(resumen, solicitud)
    await cliente.cerrar()

    assert final.recuperados == 3
    assert ruta.call_count == 3
    # Cada búsqueda esperó su turno, sin tope: la ingesta espera lo que
    # haga falta para no superar 8 búsquedas por minuto.
    assert limitador.esperas_maximas == [None, None, None]


# --- Configuración ----------------------------------------------------------


def test_configuracion_por_defecto(monkeypatch):
    monkeypatch.delenv("INGESTA_CATEGORIAS", raising=False)
    monkeypatch.delenv("INGESTA_MAX_PRODUCTOS", raising=False)
    ajustes = config.Settings(_env_file=None)
    assert ajustes.ingesta_categorias == CATEGORIAS_POR_DEFECTO
    assert ajustes.ingesta_max_productos == 500


def test_configuracion_desde_el_entorno(monkeypatch):
    monkeypatch.setenv("INGESTA_CATEGORIAS", " en:biscuits, en:breads,,"
                                             "en:biscuits ")
    monkeypatch.setenv("INGESTA_MAX_PRODUCTOS", "120")
    ajustes = config.Settings(_env_file=None)
    assert ajustes.ingesta_categorias == ["en:biscuits", "en:breads"]
    assert ajustes.ingesta_max_productos == 120
    monkeypatch.setenv("INGESTA_CATEGORIAS", "")
    assert config.Settings(_env_file=None).ingesta_categorias == []


@pytest.mark.parametrize(
    "variable, valor",
    [("INGESTA_MAX_PRODUCTOS", "501"), ("INGESTA_MAX_PRODUCTOS", "0"),
     ("INGESTA_CATEGORIAS", ",".join(f"en:c{i}" for i in range(21))),
     ("INGESTA_CATEGORIAS", "en:galletas,x")],
)
def test_configuracion_invalida(monkeypatch, variable, valor):
    monkeypatch.setenv(variable, valor)
    with pytest.raises(ValidationError):
        config.Settings(_env_file=None)


def test_ingesta_automatica_usa_la_configuracion(monkeypatch):
    monkeypatch.setattr(config.settings, "ingesta_categorias_texto",
                        "en:biscuits,en:dairies")
    monkeypatch.setattr(config.settings, "ingesta_max_productos", 300)
    solicitud = solicitud_automatica()
    assert solicitud.pais == "chile"
    assert solicitud.categorias == ["en:biscuits", "en:dairies"]
    assert solicitud.max_productos == 300


# --- Estadísticas del corpus ------------------------------------------------


def registros(*payloads):
    return [
        (mapear_producto(p, run_id=uuid.uuid4(), recuperado_en=AHORA,
                         base_url="https://world.openfoodfacts.org"), p)
        for p in payloads
    ]


def test_estadisticas_del_corpus():
    corpus = registros(
        payload(1, "Galletas de avena", "Harina, avena",
                categories_tags=["en:snacks", GALLETAS]),
        payload(2, "Galleta de leche", "Harina, leche",
                categories_tags=[GALLETAS, LACTEOS]),
        payload(3, "Pan amasado", "Harina, agua, sal"),
        # Inválido (sin ingredientes): no cuenta.
        {**payload(4, "Yogur", "x"), "ingredients_text_es": None,
         "categories_tags": [LACTEOS]},
    )
    resumen = calcular_estadisticas(corpus, [GALLETAS, LACTEOS])
    assert resumen.total_productos == 4 and resumen.validos == 3
    assert resumen.por_categoria == {GALLETAS: 2, LACTEOS: 1}
    assert resumen.sin_categoria_configurada == 1
    assert resumen.categorias_frecuentes[GALLETAS] == 2
    assert resumen.categorias_frecuentes["en:snacks"] == 1
    # galleta, avena, campo, austral, harina, leche, pan, amasado, agua,
    # sal y, de las categorías, snacks, biscuits y dairie (el singular
    # básico es para español; con el inglés no siempre acierta).
    assert resumen.terminos_distintos == 13
    assert resumen.largo_promedio["nombre"] == 2.0
    assert resumen.largo_promedio_total == pytest.approx(
        sum(resumen.largo_promedio.values())
    )


def test_estadisticas_de_corpus_vacio():
    resumen = calcular_estadisticas([], [GALLETAS])
    assert resumen.validos == 0 and resumen.terminos_distintos == 0
    assert resumen.por_categoria == {GALLETAS: 0}


RUTA_SCRIPT = (
    Path(__file__).resolve().parents[1] / "scripts" / "estadisticas_corpus.py"
)
_spec = importlib.util.spec_from_file_location("estadisticas_corpus",
                                               RUTA_SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


def test_script_de_estadisticas(tmp_path, capsys):
    repo = RepositorioCache(str(tmp_path / "cache.sqlite3"))
    repo.inicializar()
    for producto, p in registros(
        payload(1, "Galletas de avena", "Harina, avena",
                categories_tags=[GALLETAS]),
        payload(2, "Leche entera", "Leche entera",
                categories_tags=[LACTEOS]),
    ):
        repo.guardar_producto(producto, p)

    assert script.main(["--db", repo.ruta,
                        "--categorias", f"{GALLETAS},{PANES}"]) == 0
    salida = capsys.readouterr().out
    assert "Productos válidos (indexados): 2" in salida
    assert f"  {GALLETAS}: 1" in salida
    assert f"  {PANES}: 0" in salida
    assert "  sin categoría configurada: 1" in salida
    assert "Términos distintos en el índice:" in salida
    assert "Largo promedio (términos por producto):" in salida


def test_script_sin_cache(tmp_path, capsys):
    assert script.main(["--db", str(tmp_path / "no.sqlite3")]) == 2
    assert "no existe" in capsys.readouterr().err
