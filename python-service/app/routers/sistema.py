from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["sistema"])


@router.get("/")
def read_root():
    return {"status": "Servicio FastAPI activo"}


@router.get("/health")
def health_check():
    return {"status": "ok", "service": settings.service_name}
