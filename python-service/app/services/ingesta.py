"""Ingesta de productos desde /api/v2/search de Open Food Facts."""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Tuple

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.errores import FuenteNoDisponible, FuenteTimeout
from app.repositories.cache import RepositorioCache, ResultadoUpsert
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.catalogo import SIN_CLIENTE
from app.services.mapeo_off import ProductoInvalido, mapear_producto

logger = logging.getLogger(__name__)

TAMANO_PAGINA = 50


class ServicioIngesta:
    def __init__(
        self,
        repositorio: RepositorioCache,
        cliente: Optional[ClienteOpenFoodFacts],
        base_url: str,
        tamano_pagina: int = TAMANO_PAGINA,
    ) -> None:
        self._repositorio = repositorio
        self._cliente = cliente
        self._base_url = base_url
        self._tamano_pagina = tamano_pagina
        self._activa: Optional[ResumenIngesta] = None

    async def iniciar(
        self, solicitud: SolicitudIngesta
    ) -> Tuple[ResumenIngesta, bool]:
        """Registra una ejecución en curso.

        Devuelve (resumen, es_nueva). Si ya hay una en curso, devuelve esa
        en lugar de lanzar otra, para no duplicar consultas a OFF.
        """
        if self._cliente is None:
            raise FuenteNoDisponible(SIN_CLIENTE)
        if self._activa is not None:
            return self._activa, False
        resumen = ResumenIngesta(
            run_id=uuid.uuid4(),
            inicio=datetime.now(timezone.utc),
            recuperados=0, validos=0, invalidos=0, duplicados=0, errores=0,
            estado="en_curso",
        )
        self._activa = resumen
        await asyncio.to_thread(self._repositorio.guardar_ejecucion, resumen)
        logger.info("Ingesta %s iniciada: %s", resumen.run_id,
                    solicitud.model_dump())
        return resumen, True

    async def ejecutar(
        self, resumen: ResumenIngesta, solicitud: SolicitudIngesta
    ) -> ResumenIngesta:
        """Recorre las páginas de OFF y actualiza el resumen al terminar."""
        conteo = dict(recuperados=0, validos=0, invalidos=0, duplicados=0,
                      errores=0)
        tamano = min(self._tamano_pagina, solicitud.max_productos)
        estado = "fallido"
        try:
            pagina = 1
            while conteo["recuperados"] < solicitud.max_productos:
                try:
                    datos = await self._cliente.buscar_por_pais(
                        solicitud.pais, solicitud.categorias, pagina, tamano
                    )
                except (FuenteNoDisponible, FuenteTimeout) as exc:
                    conteo["errores"] += 1
                    await asyncio.to_thread(
                        self._repositorio.registrar_error_fuente,
                        exc.codigo.value, f"página {pagina}: {exc.mensaje}",
                        resumen.run_id,
                    )
                    break
                restantes = solicitud.max_productos - conteo["recuperados"]
                payloads = datos["products"][:restantes]
                for payload in payloads:
                    await self._procesar(payload, resumen.run_id, conteo)
                await self._guardar(resumen, conteo, "en_curso")
                if len(datos["products"]) < tamano:
                    break  # última página
                pagina += 1

            if conteo["errores"] == 0:
                estado = "completado"
            elif conteo["recuperados"] > 0:
                estado = "completado_con_errores"
        except Exception:
            logger.exception("Ingesta %s abortada", resumen.run_id)
        finally:
            try:
                final = await self._guardar(resumen, conteo, estado)
            finally:
                self._activa = None
            logger.info("Ingesta %s terminada: %s", resumen.run_id,
                        final.model_dump(mode="json"))
        return final

    async def _procesar(self, payload, run_id: uuid.UUID, conteo) -> None:
        conteo["recuperados"] += 1
        try:
            producto = mapear_producto(
                payload,
                run_id=run_id,
                recuperado_en=datetime.now(timezone.utc),
                base_url=self._base_url,
            )
        except ProductoInvalido:
            conteo["invalidos"] += 1
            return
        if not producto.calidad.es_valido:
            conteo["invalidos"] += 1
            return
        conteo["validos"] += 1
        resultado = await asyncio.to_thread(
            self._repositorio.guardar_producto, producto, payload
        )
        if resultado is ResultadoUpsert.duplicado:
            conteo["duplicados"] += 1

    async def _guardar(
        self, resumen: ResumenIngesta, conteo, estado: str
    ) -> ResumenIngesta:
        terminado = estado != "en_curso"
        fin = datetime.now(timezone.utc) if terminado else None
        actualizado = ResumenIngesta(
            run_id=resumen.run_id,
            inicio=resumen.inicio,
            fin=fin,
            duracion_ms=(
                int((fin - resumen.inicio).total_seconds() * 1000)
                if fin else None
            ),
            estado=estado,
            **conteo,
        )
        await asyncio.to_thread(
            self._repositorio.guardar_ejecucion, actualizado
        )
        return actualizado
