"""Cliente asíncrono de la API pública de Open Food Facts.

Respeta las reglas de la documentación oficial
(https://openfoodfacts.github.io/openfoodfacts-server/api/):
User-Agent "AppName/Version (ContactEmail)", límites por IP (15 lecturas
y 10 búsquedas por minuto) y reintentos con backoff solo ante errores de
red, timeouts, 429 y 5xx.
"""
import asyncio
import logging
import math
import random
import re
from typing import Any, Awaitable, Callable, Dict, Optional, Sequence

import httpx

from app.clients.limitador import LimiteTasaExcedido, LimitadorTasa
from app.core.errores import (
    ErrorAPI,
    FuenteNoDisponible,
    FuenteTimeout,
    NoEncontrado,
)
from app.core.logs import run_id_actual

logger = logging.getLogger(__name__)

# Margen bajo los límites oficiales para no arriesgar un baneo de la IP.
LECTURAS_POR_MINUTO = 12
BUSQUEDAS_POR_MINUTO = 8
MAX_REINTENTOS = 3
TAMANO_PAGINA_MAXIMO = 100
# /api/v2/search devuelve 503 en ráfagas más largas que la lectura de un
# producto, y la ingesta corre en segundo plano: sus reintentos parten con
# más espera (2, 4 y 8 s más jitter, en vez de 1, 2 y 4 s). Si OFF envía
# Retry-After, se respeta en ambos casos.
ESPERA_BASE_BUSQUEDAS = 2.0

CAMPOS = (
    "code",
    "product_name",
    "product_name_es",
    "brands",
    "quantity",
    "ingredients_text",
    "ingredients_text_es",
    "allergens_tags",
    "traces_tags",
    "labels_tags",
    # Categorías: el buscador las indexa (no van en el contrato).
    "categories",
    "categories_tags",
    "nutriscore_grade",
    "image_front_url",
    "image_url",
    "last_modified_t",
    "lang",
)

_FORMATO_USER_AGENT = re.compile(r"[^\s/]+/[^\s/]+ \(\S+@\S+\)")


class ClienteOpenFoodFacts:
    def __init__(
        self,
        base_url: str,
        user_agent: Optional[str],
        timeout_segundos: float = 10.0,
        *,
        limitador_lecturas: Optional[LimitadorTasa] = None,
        limitador_busquedas: Optional[LimitadorTasa] = None,
        max_reintentos: int = MAX_REINTENTOS,
        espera_base: float = 1.0,
        espera_base_busquedas: float = ESPERA_BASE_BUSQUEDAS,
        espera_maxima: float = 30.0,
        dormir: Callable[[float], Awaitable[None]] = asyncio.sleep,
        aleatorio: Callable[[], float] = random.random,
    ) -> None:
        if not user_agent or not _FORMATO_USER_AGENT.fullmatch(user_agent):
            raise ValueError(
                "OFF_USER_AGENT es obligatorio y debe tener el formato "
                "AppName/Version (ContactEmail)"
            )
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            timeout=httpx.Timeout(timeout_segundos),
            follow_redirects=False,
        )
        self._limitador_lecturas = limitador_lecturas or LimitadorTasa(
            LECTURAS_POR_MINUTO
        )
        self._limitador_busquedas = limitador_busquedas or LimitadorTasa(
            BUSQUEDAS_POR_MINUTO
        )
        self.max_reintentos = max_reintentos
        self._espera_base = espera_base
        self._espera_base_busquedas = espera_base_busquedas
        self._espera_maxima = espera_maxima
        self._dormir = dormir
        self._aleatorio = aleatorio

    @classmethod
    def desde_settings(cls, settings) -> "ClienteOpenFoodFacts":
        return cls(
            settings.off_base_url,
            settings.off_user_agent,
            settings.off_timeout_segundos,
        )

    async def cerrar(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "ClienteOpenFoodFacts":
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.cerrar()

    async def obtener_producto(
        self, codigo_barras: str, espera_maxima: Optional[float] = None
    ) -> Dict[str, Any]:
        """Lee un producto con la API v3 y devuelve el objeto `product`.

        Con `espera_maxima`, si el limitador obligaría a esperar más, falla
        de inmediato con FuenteNoDisponible (pensado para peticiones HTTP).
        """
        descripcion = f"producto {codigo_barras}"
        contexto = {"operacion": "producto", "codigo_barras": codigo_barras}
        datos = await self._get(
            f"/api/v3/product/{codigo_barras}",
            {"fields": ",".join(CAMPOS)},
            self._limitador_lecturas,
            descripcion,
            contexto,
            espera_maxima,
        )
        if datos.get("status") == "failure":
            raise NoEncontrado(
                f"El {descripcion} no existe en Open Food Facts"
            )
        producto = datos.get("product")
        if not isinstance(producto, dict):
            _log_fuente(logging.ERROR, "Respuesta sin 'product' para el %s",
                        descripcion, campos={**contexto, "codigo_http": 200,
                                             "motivo": "sin_product"})
            raise FuenteNoDisponible("Open Food Facts devolvió una respuesta "
                                     "inválida")
        return producto

    async def buscar_por_pais(
        self,
        pais: str,
        categorias: Sequence[str] = (),
        pagina: int = 1,
        tamano_pagina: int = 50,
    ) -> Dict[str, Any]:
        """Página de /api/v2/search filtrada por país y categorías (OR)."""
        if pagina < 1:
            raise ValueError("pagina debe ser al menos 1")
        if not 1 <= tamano_pagina <= TAMANO_PAGINA_MAXIMO:
            raise ValueError(
                f"tamano_pagina debe estar entre 1 y {TAMANO_PAGINA_MAXIMO}"
            )
        params = {
            "countries_tags": pais if ":" in pais else f"en:{pais}",
            "fields": ",".join(CAMPOS),
            "page": pagina,
            "page_size": tamano_pagina,
            "sort_by": "last_modified_t",
        }
        if categorias:
            params["categories_tags"] = "|".join(categorias)
        filtro = f" {'|'.join(categorias)}" if categorias else ""
        descripcion = f"búsqueda {pais}{filtro} página {pagina}"
        contexto = {"operacion": "busqueda", "pais": pais,
                    "categoria": "|".join(categorias) or None,
                    "pagina": pagina}
        datos = await self._get(
            "/api/v2/search", params, self._limitador_busquedas, descripcion,
            contexto, espera_base=self._espera_base_busquedas,
        )
        if not isinstance(datos.get("products"), list):
            _log_fuente(logging.ERROR, "Respuesta sin 'products' en la %s",
                        descripcion, campos={**contexto, "codigo_http": 200,
                                             "motivo": "sin_products"})
            raise FuenteNoDisponible("Open Food Facts devolvió una respuesta "
                                     "inválida")
        return datos

    async def _get(
        self,
        ruta: str,
        params: Dict[str, Any],
        limitador: LimitadorTasa,
        descripcion: str,
        contexto: Dict[str, Any],
        espera_maxima: Optional[float] = None,
        *,
        espera_base: Optional[float] = None,
    ) -> Dict[str, Any]:
        base = self._espera_base if espera_base is None else espera_base
        for intento in range(self.max_reintentos + 1):
            campos = {**contexto, "intento": intento + 1,
                      "max_intentos": self.max_reintentos + 1}
            try:
                await limitador.esperar_turno(espera_maxima)
            except LimiteTasaExcedido as exc:
                _log_fuente(logging.WARNING,
                            "Límite de consultas alcanzado en la %s: %s",
                            descripcion, exc,
                            campos={**campos, "motivo": "limite_de_tasa"})
                raise FuenteNoDisponible(
                    "Se alcanzó el límite de consultas a Open Food Facts; "
                    f"intenta de nuevo en {math.ceil(exc.espera_necesaria)} s"
                ) from None
            retry_after: Optional[float] = None
            try:
                respuesta = await self._http.get(ruta, params=params)
            except httpx.TimeoutException as exc:
                fallo: ErrorAPI = FuenteTimeout(
                    "Open Food Facts no respondió a tiempo"
                )
                motivo = f"timeout ({type(exc).__name__})"
            except httpx.TransportError as exc:
                fallo = FuenteNoDisponible(
                    "Open Food Facts no está disponible"
                )
                motivo = f"error de red ({type(exc).__name__}: {exc})"
            else:
                estado = respuesta.status_code
                campos["codigo_http"] = estado
                if estado == 404:
                    raise NoEncontrado(
                        f"El {descripcion} no existe en Open Food Facts"
                    )
                if 300 <= estado < 400:
                    raise NoEncontrado(
                        f"El {descripcion} no es un producto alimenticio"
                    )
                if estado == 429 or estado >= 500:
                    fallo = FuenteNoDisponible(
                        "Open Food Facts no está disponible"
                    )
                    motivo = f"HTTP {estado}"
                    retry_after = _segundos_retry_after(respuesta)
                elif estado >= 400:
                    _log_fuente(logging.ERROR,
                                "Open Food Facts rechazó la %s: HTTP %d",
                                descripcion, estado,
                                campos={**campos, "motivo": f"HTTP {estado}"})
                    raise FuenteNoDisponible(
                        f"Open Food Facts rechazó la petición (HTTP {estado})"
                    )
                else:
                    return self._leer_json(respuesta, descripcion, campos)

            campos["motivo"] = motivo
            if intento == self.max_reintentos:
                _log_fuente(logging.ERROR, "Open Food Facts falló en la %s "
                            "tras %d intentos: %s", descripcion, intento + 1,
                            motivo, campos=campos)
                raise fallo
            espera = self._calcular_espera(intento, retry_after, base)
            _log_fuente(logging.WARNING, "Open Food Facts falló en la %s: %s; "
                        "reintento %d/%d en %.1f s", descripcion, motivo,
                        intento + 1, self.max_reintentos, espera,
                        campos={**campos, "espera_s": round(espera, 3)})
            await self._dormir(espera)
        raise AssertionError("inalcanzable")

    def _calcular_espera(
        self, intento: int, retry_after: Optional[float], base: float
    ) -> float:
        exponencial = min(self._espera_maxima, base * 2 ** intento)
        espera = exponencial + self._aleatorio() * base
        if retry_after is not None:
            espera = max(espera, min(retry_after, self._espera_maxima))
        return espera

    @staticmethod
    def _leer_json(
        respuesta: httpx.Response, descripcion: str, campos: Dict[str, Any]
    ) -> Dict[str, Any]:
        try:
            datos = respuesta.json()
        except ValueError:
            _log_fuente(logging.ERROR,
                        "Open Food Facts devolvió JSON inválido en la %s",
                        descripcion,
                        campos={**campos, "motivo": "json_invalido"})
            raise FuenteNoDisponible(
                "Open Food Facts devolvió una respuesta inválida"
            ) from None
        if not isinstance(datos, dict):
            _log_fuente(logging.ERROR, "Open Food Facts devolvió un JSON "
                        "inesperado en la %s", descripcion,
                        campos={**campos, "motivo": "json_inesperado"})
            raise FuenteNoDisponible(
                "Open Food Facts devolvió una respuesta inválida"
            )
        return datos


def _log_fuente(
    nivel: int, mensaje: str, *args: Any, campos: Dict[str, Any]
) -> None:
    """Falla de Open Food Facts como log estructurado. Siempre trae los
    mismos campos; run_id es null si la petición no viene de una ingesta."""
    logger.log(nivel, mensaje, *args, extra={
        "evento": "error_fuente",
        "categoria": None,
        "pagina": None,
        "intento": None,
        "codigo_http": None,
        "motivo": None,
        **campos,
        "run_id": run_id_actual(),
    })


def _segundos_retry_after(respuesta: httpx.Response) -> Optional[float]:
    valor = respuesta.headers.get("Retry-After")
    try:
        return float(valor) if valor is not None else None
    except ValueError:
        return None
