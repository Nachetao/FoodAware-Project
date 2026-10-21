import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import NamedTuple, Optional

from fastapi import FastAPI

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.config import settings
from app.core.errores import registrar_manejadores_error
from app.core.request_id import RequestIdMiddleware
from app.procesamiento import VERSION_PROCESAMIENTO
from app.repositories.cache import RepositorioCache
from app.routers import analisis, catalogo, ingesta, metricas, sistema
from app.schemas.ingesta import SolicitudIngesta
from app.services.busqueda import ServicioBusqueda
from app.services.catalogo import ServicioCatalogo
from app.services.ingesta import ServicioIngesta
from app.services.planificador import PlanificadorIngesta
from app.services.reprocesamiento import reprocesar_cache

logger = logging.getLogger(__name__)


class Servicios(NamedTuple):
    catalogo: ServicioCatalogo
    ingesta: ServicioIngesta
    busqueda: ServicioBusqueda


def construir_servicios(
    repositorio: RepositorioCache,
    cliente: Optional[ClienteOpenFoodFacts],
) -> Servicios:
    busqueda_ = ServicioBusqueda(repositorio)
    catalogo_ = ServicioCatalogo(
        repositorio,
        cliente,
        settings.off_base_url,
        # Una petición HTTP no espera al limitador más que este tope; la
        # ingesta en segundo plano sí espera lo necesario.
        espera_maxima=settings.limitador_espera_max_segundos,
        ttl=timedelta(hours=settings.cache_ttl_horas),
    )
    # Al terminar cada ingesta, el índice se reconstruye con lo nuevo.
    ingesta_ = ServicioIngesta(repositorio, cliente, settings.off_base_url,
                               al_terminar=busqueda_.reconstruir)
    return Servicios(catalogo_, ingesta_, busqueda_)


def solicitud_automatica() -> SolicitudIngesta:
    """Ingesta inicial y periódica: Chile, repartida entre las categorías
    de INGESTA_CATEGORIAS, hasta INGESTA_MAX_PRODUCTOS productos."""
    return SolicitudIngesta(
        categorias=settings.ingesta_categorias,
        max_productos=settings.ingesta_max_productos,
    )


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
    # Antes de atender peticiones: los productos procesados con reglas
    # anteriores se rehacen desde el payload guardado, sin llamar a OFF.
    reprocesado = await asyncio.to_thread(
        reprocesar_cache, repositorio, settings.off_base_url
    )
    if reprocesado.reprocesados or reprocesado.errores:
        logger.info("Caché reprocesada (versión %d): %d productos, %d "
                    "errores", VERSION_PROCESAMIENTO,
                    reprocesado.reprocesados, reprocesado.errores)
    try:
        cliente = ClienteOpenFoodFacts.desde_settings(settings)
    except ValueError as exc:
        cliente = None
        logger.error("Open Food Facts deshabilitado: %s", exc)

    app.state.repositorio = repositorio
    servicios = construir_servicios(repositorio, cliente)
    app.state.catalogo = servicios.catalogo
    app.state.ingesta = servicios.ingesta
    app.state.busqueda = servicios.busqueda
    # El índice se arma después del reprocesamiento, con los datos al día.
    await servicios.busqueda.reconstruir()
    tarea = None
    if cliente is not None:
        planificador = PlanificadorIngesta(
            app.state.ingesta,
            repositorio,
            intervalo=timedelta(hours=settings.ingesta_intervalo_horas),
            al_iniciar=settings.ingesta_al_iniciar,
            solicitud=solicitud_automatica(),
        )
        tarea = asyncio.create_task(planificador.bucle())
    try:
        yield
    finally:
        if tarea is not None:
            tarea.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarea
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
