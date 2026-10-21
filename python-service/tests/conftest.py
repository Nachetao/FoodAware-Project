import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.core.errores import NoEncontrado
from app.main import app, construir_servicios
from app.services.ingesta import ServicioIngesta
from tests.payloads_off import productos_de_ejemplo

BASE_OFF = "https://world.openfoodfacts.org"


class ClienteOFFFalso:
    """Reemplaza a ClienteOpenFoodFacts: nunca sale a la red.

    `productos` mapea código -> payload o excepción; `paginas` es la lista
    de respuestas (o excepciones) de /api/v2/search, desde la página 1.
    """

    def __init__(self):
        self.productos = {}
        self.paginas = []
        self.llamadas = []
        self.esperas_maximas = []

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
        if pagina > len(self.paginas):
            return {"products": []}
        efecto = self.paginas[pagina - 1]
        if isinstance(efecto, Exception):
            raise efecto
        return efecto

    async def cerrar(self):
        pass


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
        app.state.catalogo, _ = construir_servicios(repositorio, off_falso)
        app.state.ingesta = ServicioIngesta(repositorio, off_falso,
                                            BASE_OFF, tamano_pagina=2)
        yield cliente_http


@pytest.fixture
def repositorio(client):
    return app.state.repositorio


@pytest.fixture
def catalogo_sembrado(repositorio):
    productos = productos_de_ejemplo()
    for producto in productos:
        repositorio.guardar_producto(
            producto, {"code": producto.codigo_barras}
        )
    return productos
