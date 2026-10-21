"""Acceso a los servicios creados en el arranque (ver app.main)."""
from fastapi import Request

from app.repositories.cache import RepositorioCache
from app.services.busqueda import ServicioBusqueda
from app.services.catalogo import ServicioCatalogo
from app.services.ingesta import ServicioIngesta
from app.services.metricas import ServicioMetricas


def obtener_repositorio(request: Request) -> RepositorioCache:
    return request.app.state.repositorio


def obtener_catalogo(request: Request) -> ServicioCatalogo:
    return request.app.state.catalogo


def obtener_ingesta(request: Request) -> ServicioIngesta:
    return request.app.state.ingesta


def obtener_busqueda(request: Request) -> ServicioBusqueda:
    return request.app.state.busqueda


def obtener_metricas(request: Request) -> ServicioMetricas:
    return request.app.state.metricas
