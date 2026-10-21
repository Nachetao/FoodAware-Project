"""Ingesta de productos desde /api/v2/search de Open Food Facts."""
import asyncio
import logging
import math
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from typing import Counter as CounterType
from typing import Dict, List, Optional, Tuple

from app.clients.open_food_facts import ClienteOpenFoodFacts
from app.core.errores import FuenteNoDisponible, FuenteTimeout
from app.core.logs import contexto_ejecucion
from app.procesamiento.calidad import INVALIDANTES
from app.repositories.cache import (
    DetalleIngesta,
    RepositorioCache,
    ResultadoUpsert,
)
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from app.services.catalogo import SIN_CLIENTE
from app.services.mapeo_off import (
    ProductoInvalido,
    mapear_producto,
    tiene_ingredientes_utilizables,
)

logger = logging.getLogger(__name__)

# Motivo de invalidez de un payload que no se puede ni mapear: su código no
# tiene de 8 a 14 dígitos (el contrato no lo admite como Producto).
CODIGO_INVALIDO = "codigo_barras_invalido"

TAMANO_PAGINA = 50
# Antes de reintentar las categorías que fallaron. Los 503 de OFF llegan en
# ráfagas: tras agotar los reintentos del cliente conviene esperar más.
PAUSA_REINTENTO_SEGUNDOS = 60.0


@dataclass
class _Avance:
    """Cómo va la búsqueda de una categoría dentro de una ejecución."""

    categorias: List[str]
    # Fijo para toda la ejecución: si cambiara entre rondas, la página N
    # apuntaría a otros productos.
    tamano: int
    pagina: int = 1  # próxima página a pedir
    traidos: int = 0  # productos nuevos que aportó
    # La última petición falló tras los reintentos del cliente.
    fallo: bool = False

    @property
    def descripcion(self) -> str:
        return f"categoría {self.categorias[0]}, " if self.categorias else ""


def cuota_por_categoria(restante: int, categorias_restantes: int) -> int:
    """Parte del máximo que le toca a la próxima categoría.

    Se recalcula antes de cada categoría con lo que queda, así lo que no
    usa una categoría con pocos productos pasa a las siguientes. Ejemplo
    con 500 y 7 categorías: 72, 72, 72, 71, 71, 71, 71. Si la primera solo
    trae 30, la segunda recibe ceil(470 / 6) = 79.
    """
    return math.ceil(restante / categorias_restantes)


@dataclass(frozen=True)
class _Resultado:
    """Cómo resultó procesar un producto; se reutiliza si se repite."""

    es_valido: bool
    con_ingredientes: bool
    motivos_invalidez: Tuple[str, ...] = ()


@dataclass
class _Conteo:
    """Conteos de una ejecución: los del contrato y el detalle interno."""

    recuperados: int = 0
    validos: int = 0
    invalidos: int = 0
    errores: int = 0
    repetidos_en_ejecucion: int = 0
    existentes_sin_cambios: int = 0
    con_ingredientes: int = 0
    peticiones: int = 0
    fallas_recuperadas: int = 0
    motivos_invalidez: CounterType[str] = field(default_factory=Counter)

    @property
    def duplicados(self) -> int:
        """El campo del contrato: válidos descartados por existir ya con el
        mismo contenido, en la ejecución o en la caché."""
        return self.repetidos_en_ejecucion + self.existentes_sin_cambios

    def contar(self, resultado: _Resultado) -> None:
        """Cuenta un producto recuperado (nuevo o repetido)."""
        self.recuperados += 1
        self.con_ingredientes += resultado.con_ingredientes
        if resultado.es_valido:
            self.validos += 1
        else:
            self.invalidos += 1
            self.motivos_invalidez.update(resultado.motivos_invalidez)

    def contar_repetido(self, resultado: _Resultado) -> None:
        """Un producto que ya llegó antes en la misma ejecución.

        Se cuenta como recuperado con el resultado de su primera vez. Si es
        válido es un duplicado (válido descartado por repetido), así se
        mantiene duplicados <= validos; si es inválido, solo un inválido
        más, porque `duplicados` solo cuenta válidos.
        """
        self.contar(resultado)
        if resultado.es_valido:
            self.repetidos_en_ejecucion += 1

    def resumen(self, base: ResumenIngesta, estado: str) -> ResumenIngesta:
        fin = datetime.now(timezone.utc) if estado != "en_curso" else None
        return ResumenIngesta(
            run_id=base.run_id,
            inicio=base.inicio,
            fin=fin,
            duracion_ms=(
                int((fin - base.inicio).total_seconds() * 1000)
                if fin else None
            ),
            recuperados=self.recuperados,
            validos=self.validos,
            invalidos=self.invalidos,
            duplicados=self.duplicados,
            errores=self.errores,
            estado=estado,
        )

    def detalle(self) -> DetalleIngesta:
        return DetalleIngesta(
            repetidos_en_ejecucion=self.repetidos_en_ejecucion,
            existentes_sin_cambios=self.existentes_sin_cambios,
            con_ingredientes=self.con_ingredientes,
            peticiones=self.peticiones,
            fallas_recuperadas=self.fallas_recuperadas,
            motivos_invalidez=dict(self.motivos_invalidez),
        )


class ServicioIngesta:
    def __init__(
        self,
        repositorio: RepositorioCache,
        cliente: Optional[ClienteOpenFoodFacts],
        base_url: str,
        tamano_pagina: int = TAMANO_PAGINA,
        al_terminar: Optional[Callable[[], Awaitable[Any]]] = None,
        *,
        pausa_reintento: float = PAUSA_REINTENTO_SEGUNDOS,
        dormir: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._repositorio = repositorio
        self._cliente = cliente
        self._base_url = base_url
        self._tamano_pagina = tamano_pagina
        self._pausa_reintento = pausa_reintento
        self._dormir = dormir
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
        # Se registra en el contexto de quien la pidió (la petición POST o
        # el planificador): este log une su request_id con el run_id.
        logger.info("Ingesta %s iniciada", resumen.run_id,
                    extra={"run_id": str(resumen.run_id),
                           "solicitud": solicitud.model_dump()})
        return resumen, True

    async def ejecutar(
        self, resumen: ResumenIngesta, solicitud: SolicitudIngesta
    ) -> ResumenIngesta:
        """Corre la ingesta con su run_id como request_id de los logs."""
        with contexto_ejecucion(resumen.run_id):
            return await self._ejecutar(resumen, solicitud)

    async def _ejecutar(
        self, resumen: ResumenIngesta, solicitud: SolicitudIngesta
    ) -> ResumenIngesta:
        """Recorre las páginas de OFF y actualiza el resumen al terminar.

        Sin categorías hace una sola búsqueda por país. Con categorías hace
        una búsqueda por categoría y reparte max_productos entre ellas (ver
        cuota_por_categoria), para que el corpus no quede dominado por la
        primera. Todas las búsquedas pasan por el limitador del cliente.

        Si una categoría falla (OFF sigue respondiendo 503 tras los
        reintentos del cliente), la cuota que no alcanzó a usar se reserva
        y, al final, una segunda ronda la reintenta desde la página que
        falló (ver _reintentar). `errores` cuenta solo las categorías que
        siguen fallando en esa ronda: las páginas perdidas de verdad.
        """
        conteo = _Conteo()
        # Código -> resultado, de los productos ya procesados en esta
        # ejecución. Un producto que está en dos categorías se procesa una
        # sola vez; las repeticiones solo se cuentan (contar_repetido).
        vistos: Dict[str, _Resultado] = {}
        # Productos distintos traídos: es lo que limita max_productos y las
        # cuotas. `recuperados` incluye además las repeticiones, así que
        # puede superar a max_productos.
        nuevos = 0
        estado = "fallido"
        try:
            grupos = [[c] for c in solicitud.categorias] or [[]]
            avances: List[_Avance] = []
            # Cuota que no usó una categoría que falló: se guarda para su
            # reintento en vez de pasar a las siguientes, que si no se la
            # comerían y no quedaría nada para reintentar.
            reservado = 0
            for indice, categorias in enumerate(grupos):
                restante = solicitud.max_productos - nuevos - reservado
                if restante <= 0:
                    break
                cuota = cuota_por_categoria(restante, len(grupos) - indice)
                avance = _Avance(categorias,
                                 tamano=min(self._tamano_pagina, cuota))
                avances.append(avance)
                traidos = await self._ingerir_categoria(
                    resumen, solicitud.pais, avance, cuota, conteo, vistos
                )
                nuevos += traidos
                if avance.fallo:
                    reservado += cuota - traidos
            fallidas_primera_ronda = sum(a.fallo for a in avances)
            nuevos += await self._reintentar(
                resumen, solicitud, avances, nuevos, conteo, vistos
            )
            # Cada falla, recuperada o no, ya quedó en errores_fuente.
            conteo.errores = sum(a.fallo for a in avances)
            conteo.fallas_recuperadas = fallidas_primera_ronda - conteo.errores

            if conteo.errores == 0:
                estado = "completado"
            elif conteo.recuperados > 0:
                estado = "completado_con_errores"
        except Exception:
            logger.exception("Ingesta %s abortada", resumen.run_id)
        finally:
            try:
                final = await self._guardar(resumen, conteo, estado)
            finally:
                self._activa = None
            logger.info("Ingesta %s terminada: %s", resumen.run_id,
                        final.estado,
                        extra={"resumen": final.model_dump(mode="json")})
        if self._al_terminar is not None:
            try:
                await self._al_terminar()
            except Exception:
                # El resumen ya quedó guardado; el índice anterior sigue
                # sirviendo búsquedas.
                logger.exception("Falló el aviso de fin de la ingesta %s",
                                 resumen.run_id)
        return final

    async def _reintentar(
        self,
        resumen: ResumenIngesta,
        solicitud: SolicitudIngesta,
        avances: List[_Avance],
        nuevos: int,
        conteo: _Conteo,
        vistos: Dict[str, _Resultado],
    ) -> int:
        """Segunda y última ronda para las categorías que fallaron.

        Espera PAUSA_REINTENTO_SEGUNDOS y continúa cada una desde la página
        que falló. El presupuesto que queda (incluida la cuota reservada) se
        reparte solo entre ellas. Devuelve cuántos productos nuevos trajo.
        """
        fallidas = [a for a in avances if a.fallo]
        if not fallidas:
            return 0
        logger.warning("Ingesta %s: %d categoría(s) fallaron; se reintentan "
                       "en %.0f s", resumen.run_id, len(fallidas),
                       self._pausa_reintento)
        await self._dormir(self._pausa_reintento)
        traidos = 0
        for indice, avance in enumerate(fallidas):
            restante = solicitud.max_productos - nuevos - traidos
            if restante <= 0:
                break
            cuota = cuota_por_categoria(restante, len(fallidas) - indice)
            traidos += await self._ingerir_categoria(
                resumen, solicitud.pais, avance, cuota, conteo, vistos,
                reintento=True,
            )
        return traidos

    async def _ingerir_categoria(
        self,
        resumen: ResumenIngesta,
        pais: str,
        avance: _Avance,
        cuota: int,
        conteo: _Conteo,
        vistos: Dict[str, _Resultado],
        *,
        reintento: bool = False,
    ) -> int:
        """Pagina la búsqueda de `avance` desde su próxima página hasta
        juntar `cuota` productos nuevos o llegar a la última página.

        Si la fuente falla, registra la falla en errores_fuente, marca
        `avance.fallo` y deja `avance.pagina` en la que falló, para que la
        segunda ronda siga desde ahí. Devuelve cuántos nuevos trajo.
        """
        avance.fallo = False
        traidos = 0
        while traidos < cuota:
            conteo.peticiones += 1
            try:
                datos = await self._cliente.buscar_por_pais(
                    pais, avance.categorias, avance.pagina, avance.tamano
                )
            except (FuenteNoDisponible, FuenteTimeout) as exc:
                avance.fallo = True
                ronda = "reintento, " if reintento else ""
                await asyncio.to_thread(
                    self._repositorio.registrar_error_fuente,
                    exc.codigo.value,
                    f"{ronda}{avance.descripcion}página {avance.pagina}: "
                    f"{exc.mensaje}",
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
                    conteo.contar_repetido(vistos[codigo])
                    continue
                traidos += 1
                resultado = await self._procesar(payload, resumen.run_id,
                                                 conteo)
                if codigo:
                    vistos[codigo] = resultado
            await self._guardar(resumen, conteo, "en_curso")
            if len(datos["products"]) < avance.tamano:
                break  # última página
            avance.pagina += 1
        avance.traidos += traidos
        logger.info("Ingesta %s: %s%s%d de %d productos%s", resumen.run_id,
                    "reintento, " if reintento else "", avance.descripcion,
                    traidos, cuota, " (falló)" if avance.fallo else "")
        return traidos

    async def _procesar(
        self, payload, run_id: uuid.UUID, conteo: _Conteo
    ) -> _Resultado:
        """Mapea, valida y guarda un producto nuevo en la ejecución."""
        try:
            producto = mapear_producto(
                payload,
                run_id=run_id,
                recuperado_en=datetime.now(timezone.utc),
                base_url=self._base_url,
            )
        except ProductoInvalido:
            resultado = _Resultado(
                es_valido=False,
                con_ingredientes=tiene_ingredientes_utilizables(payload),
                motivos_invalidez=(CODIGO_INVALIDO,),
            )
            conteo.contar(resultado)
            return resultado
        resultado = _Resultado(
            es_valido=producto.calidad.es_valido,
            con_ingredientes=bool(producto.ingredientes),
            motivos_invalidez=tuple(p for p in producto.calidad.problemas
                                    if p in INVALIDANTES),
        )
        conteo.contar(resultado)
        if resultado.es_valido:
            guardado = await asyncio.to_thread(
                self._repositorio.guardar_producto, producto, payload
            )
            if guardado is ResultadoUpsert.duplicado:
                conteo.existentes_sin_cambios += 1
        return resultado

    async def _guardar(
        self, resumen: ResumenIngesta, conteo: _Conteo, estado: str
    ) -> ResumenIngesta:
        actualizado = conteo.resumen(resumen, estado)
        await asyncio.to_thread(
            self._repositorio.guardar_ejecucion, actualizado, conteo.detalle()
        )
        return actualizado
