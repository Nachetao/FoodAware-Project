from fastapi import FastAPI

from app.core.config import settings
from app.routers import analisis, sistema

app = FastAPI(title=settings.app_name)

app.include_router(sistema.router)
app.include_router(analisis.router)
