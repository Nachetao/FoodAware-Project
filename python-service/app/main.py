from fastapi import FastAPI

from app.core.config import settings
from app.core.errores import registrar_manejadores_error
from app.core.request_id import RequestIdMiddleware
from app.routers import analisis, catalogo, operacion, sistema

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Contrato entre FastAPI y NestJS de FoodAware. Los endpoints de "
        "productos, búsqueda, ingesta y métricas son stubs con datos de "
        "ejemplo y responden con el header X-Stub: true."
    ),
)
app.add_middleware(RequestIdMiddleware)
registrar_manejadores_error(app)

app.include_router(sistema.router)
app.include_router(analisis.router)
app.include_router(catalogo.router)
app.include_router(operacion.router)
