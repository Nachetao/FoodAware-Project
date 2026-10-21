"""Ingesta de productos desde /api/v2/search de Open Food Facts."""
import asyncio
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.errores import FuenteNoDisponible, FuenteTimeout
from app.repositories.cache import RepositorioCache, ResultadoUpsert
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.catalogo import SIN_CLIENTE
from app.services.mapeo_off import ProductoInvalido, mapear_producto

logger = logging.getLogger(__name__)

TAMANO_PAGINA = 50


def cuota_por_categoria(restante: int, categorias_restantes: int) -> int:
    """Parte del máximo que le toca a la próxima categoría.

    Se recalcula antes de cada categoría con lo que queda, así lo que no
    usa una categoría con pocos productos pasa a las siguientes. Ejemplo
    con 500 y 7 categorías: 72, 72, 72, 71, 71, 71, 71. Si la primera solo
    trae 30, la segunda recibe ceil(470 / 6) = 79.
    """
    return math.ceil(restante / categorias_restantes)


def _contar_repetido(conteo: Dict[str, int], *, era_valido: bool) -> None:
    """Cuenta un producto que ya llegó antes en la misma ejecución.

    Es un duplicado real, así que suma a recuperados. Si era válido, es un
    válido descartado por existir ya con el mismo contenido: suma a validos
    y a duplicados, igual que un duplicado de la caché (así se mantiene
    duplicados <= validos). Si era inválido, vuelve a contar como inválido:
    `duplicados` solo cuenta válidos (validos + invalidos <= recuperados).
    """
    conteo["recuperados"] += 1
    if era_valido:
        conteo["validos"] += 1
        conteo["duplicados"] += 1
    else:
        conteo["invalidos"] += 1


class ServicioIngesta:
    def __init__(
        self,
        repositorio: RepositorioCache,
        cliente: Optional[ClienteOpenFoodFacts],
        base_url: str,
        tamano_pagina: int = TAMANO_PAGINA,
        al_terminar: Optional[Callable[[], Awaitable[Any]]] = None,
    ) -> None:
        self._repositorio = repositorio
        self._cliente = cliente
        self._base_url = base_url
        self._tamano_pagina = tamano_pagina
        # Se llama al terminar cada ejecución (p. ej. reconstruir el índice
        # de búsqueda con los productos nuevos).
        self._al_terminar = al_terminar
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
        """Recorre las páginas de OFF y actualiza el resumen al terminar.

        Sin categorías hace una sola búsqueda por país. Con categorías hace
        una búsqueda por categoría y reparte max_productos entre ellas (ver
        cuota_por_categoria), para que el corpus no quede dominado por la
        primera. Todas las búsquedas pasan por el limitador del cliente.
        """
        conteo = dict(recuperados=0, validos=0, invalidos=0, duplicados=0,
                      errores=0)
        # Código -> si fue válido, de los productos ya procesados en esta
        # ejecución. Un producto que está en dos categorías se procesa una
        # sola vez; las repeticiones solo se cuentan (ver _contar_repetido).
        vistos: Dict[str, bool] = {}
        # Productos distintos traídos: es lo que limita max_productos y las
        # cuotas. `recuperados` incluye además las repeticiones, así que
        # puede superar a max_productos.
        nuevos = 0
        estado = "fallido"
        try:
            grupos = [[c] for c in solicitud.categorias] or [[]]
            for indice, categorias in enumerate(grupos):
                restante = solicitud.max_productos - nuevos
                if restante <= 0:
                    break
                cuota = cuota_por_categoria(restante, len(grupos) - indice)
                nuevos += await self._ingerir_categoria(
                    resumen, solicitud.pais, categorias, cuota, conteo,
                    vistos,
                )

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
        if self._al_terminar is not None:
            try:
                await self._al_terminar()
            except Exception:
                # El resumen ya quedó guardado; el índice anterior sigue
                # sirviendo búsquedas.
                logger.exception("Falló el aviso de fin de la ingesta %s",
                                 resumen.run_id)
        return final

    async def _ingerir_categoria(
        self,
        resumen: ResumenIngesta,
        pais: str,
        categorias: List[str],
        cuota: int,
        conteo: Dict[str, int],
        vistos: Dict[str, bool],
    ) -> int:
        """Pagina una búsqueda hasta juntar `cuota` productos nuevos o
        llegar a la última página. Si la fuente falla, registra el error y
        sigue con la próxima categoría. Devuelve cuántos nuevos trajo."""
        descripcion = f"categoría {categorias[0]}, " if categorias else ""
        tamano = min(self._tamano_pagina, cuota)
        traidos = 0
        pagina = 1
        while traidos < cuota:
            try:
                datos = await self._cliente.buscar_por_pais(
                    pais, categorias, pagina, tamano
                )
            except (FuenteNoDisponible, FuenteTimeout) as exc:
                conteo["errores"] += 1
                await asyncio.to_thread(
                    self._repositorio.registrar_error_fuente,
                    exc.codigo.value,
                    f"{descripcion}página {pagina}: {exc.mensaje}",
                    resumen.run_id,
                )
                break
            for payload in datos["products"]:
                if traidos >= cuota:
                    break
                codigo = str(payload.get("code") or "")
                if codigo in vistos:
                    # Ya vino en otra categoría de esta ejecución: se cuenta,
                    # pero no gasta la cuota de esta categoría.
                    _contar_repetido(conteo, era_valido=vistos[codigo])
                    continue
                traidos += 1
                es_valido = await self._procesar(payload, resumen.run_id,
                                                 conteo)
                if codigo:
                    vistos[codigo] = es_valido
            await self._guardar(resumen, conteo, "en_curso")
            if len(datos["products"]) < tamano:
                break  # última página
            pagina += 1
        logger.info("Ingesta %s: %s%d de %d productos", resumen.run_id,
                    descripcion, traidos, cuota)
        return traidos

    async def _procesar(self, payload, run_id: uuid.UUID, conteo) -> bool:
        """Mapea, valida y guarda; devuelve si el producto es válido."""
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
            return False
        if not producto.calidad.es_valido:
            conteo["invalidos"] += 1
            return False
        conteo["validos"] += 1
        resultado = await asyncio.to_thread(
            self._repositorio.guardar_producto, producto, payload
        )
        if resultado is ResultadoUpsert.duplicado:
            conteo["duplicados"] += 1
        return True

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
