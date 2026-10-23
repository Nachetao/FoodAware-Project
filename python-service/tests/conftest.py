import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.core.errores import NoEncontrado
from app.main import app, construir_servicios
from app.services.ingesta import ServicioIngesta
from tests.payloads_off import productos_de_ejemplo

BASE_OFF = "https://world.openfoodfacts.org"


def pytest_configure(config):
    # CI corre por separado `pytest -m "not recuperacion"` (unitarias) y
    # `pytest -m recuperacion`.
    config.addinivalue_line(
        "markers",
        "recuperacion: proceso de recuperación de información (ingesta, "
        "preparación, búsqueda y evaluación)",
    )


class ClienteOFFFalso:
    """Reemplaza a ClienteOpenFoodFacts: nunca sale a la red.

    `productos` mapea código -> payload o excepción; `paginas` es la lista
    de respuestas (o excepciones) de /api/v2/search, desde la página 1.
    `paginas_por_categoria` hace lo mismo para una categoría específica;
    las categorías que no están ahí usan `paginas`. Una página puede ser
    una lista de efectos que se consumen en orden (el último se repite),
    para simular un 503 que se recupera: [FuenteNoDisponible(...), pagina].
    `dormir` reemplaza la pausa antes del reintento de la ingesta.
    """

    def __init__(self):
        self.productos = {}
        self.paginas = []
        self.paginas_por_categoria = {}
        self.llamadas = []
        self.esperas_maximas = []
        self.pausas = []

    async def dormir(self, segundos):
        self.pausas.append(segundos)

    async def obtener_producto(self, codigo_barras, espera_maxima=None):
        self.llamadas.append(("producto", codigo_barras))
        self.esperas_maximas.append(espera_maxima)
        efecto = self.productos.get(codigo_barras)
        if efecto is None:
            raise NoEncontrado(
                f"El producto {codigo_barras} no existe en Open Food Facts"
            )
        if isinstance(efecto, Exception):
            raise efecto
        return efecto

    async def buscar_por_pais(self, pais, categorias=(), pagina=1,
                              tamano_pagina=50):
        self.llamadas.append(
            ("busqueda", pais, tuple(categorias), pagina, tamano_pagina)
        )
        paginas = self.paginas
        if len(categorias) == 1:
            paginas = self.paginas_por_categoria.get(categorias[0], paginas)
        if pagina > len(paginas):
            return {"products": []}
        efecto = paginas[pagina - 1]
        if isinstance(efecto, list):
            efecto = efecto.pop(0) if len(efecto) > 1 else efecto[0]
        if isinstance(efecto, Exception):
            raise efecto
        return efecto

    async def cerrar(self):
        pass


@pytest.fixture(autouse=True)
def sin_semilla(monkeypatch):
    # Los tests parten con la caché vacía; los de la semilla la activan.
    monkeypatch.setattr(config.settings, "cargar_semilla_si_vacia", False)


@pytest.fixture
def off_falso():
    return ClienteOFFFalso()


@pytest.fixture
def client(tmp_path, monkeypatch, off_falso):
    monkeypatch.setattr(config.settings, "cache_db_path",
                        str(tmp_path / "cache.sqlite3"))
    # Sin User-Agent el arranque no crea un cliente real de OFF.
    monkeypatch.setattr(config.settings, "off_user_agent", None)
    with TestClient(app) as cliente_http:
        repositorio = app.state.repositorio
        servicios = construir_servicios(repositorio, off_falso)
        app.state.catalogo = servicios.catalogo
        app.state.busqueda = servicios.busqueda
        app.state.ingesta = ServicioIngesta(
            repositorio, off_falso, BASE_OFF, tamano_pagina=2,
            al_terminar=servicios.busqueda.reconstruir,
            dormir=off_falso.dormir,
        )
        yield cliente_http


@pytest.fixture
def repositorio(client):
    return app.state.repositorio


@pytest.fixture
def busqueda(client):
    return app.state.busqueda


@pytest.fixture
def catalogo_sembrado(repositorio, busqueda):
    productos = productos_de_ejemplo()
    for producto in productos:
        repositorio.guardar_producto(
            producto, {"code": producto.codigo_barras}
        )
    # El índice se arma al iniciar; aquí se siembra después.
    busqueda.reconstruir_ahora()
    return productos
