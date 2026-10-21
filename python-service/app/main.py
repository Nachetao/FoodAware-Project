import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.config import settings
from app.core.errores import registrar_manejadores_error
from app.core.request_id import RequestIdMiddleware
from app.repositories.cache import RepositorioCache
from app.routers import analisis, catalogo, ingesta, metricas, sistema
from app.services.catalogo import ServicioCatalogo
from app.services.ingesta import ServicioIngesta

logger = logging.getLogger(__name__)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    repositorio = RepositorioCache(settings.cache_db_path)
    await asyncio.to_thread(repositorio.inicializar)
    interrumpidas = await asyncio.to_thread(
        repositorio.marcar_ejecuciones_interrumpidas
    )
    if interrumpidas:
        logger.warning("%d ingesta(s) interrumpida(s) marcadas como fallidas",
                       interrumpidas)
    try:
        cliente = ClienteOpenFoodFacts.desde_settings(settings)
    except ValueError as exc:
        cliente = None
        logger.error("Open Food Facts deshabilitado: %s", exc)

    app.state.repositorio = repositorio
    app.state.catalogo = ServicioCatalogo(
        repositorio, cliente, settings.off_base_url
    )
    app.state.ingesta = ServicioIngesta(
        repositorio, cliente, settings.off_base_url
    )
    try:
        yield
    finally:
        if cliente is not None:
            await cliente.cerrar()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Contrato entre FastAPI y NestJS de FoodAware. Productos, búsqueda "
        "e ingesta usan Open Food Facts y una caché local; las métricas aún "
        "son stubs con datos de ejemplo y responden con el header "
        "X-Stub: true."
    ),
    lifespan=ciclo_de_vida,
)
app.add_middleware(RequestIdMiddleware)
registrar_manejadores_error(app)

app.include_router(sistema.router)
app.include_router(analisis.router)
app.include_router(catalogo.router)
app.include_router(ingesta.router)
app.include_router(metricas.router)
