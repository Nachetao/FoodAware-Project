"""Métricas de calidad de los datos (GET /metrics/quality).

Estrategia de evaluación: medir el pipeline de datos con los registros
reales que deja cada ingesta (cuántos productos llegaron, cuántos sirven,
cuántos se repiten) y el estado de la caché (cuántos hay, qué tan
recientes). Las ingestas se agregan sumando conteos, no promediando
porcentajes: así una ingesta de 400 productos pesa más que una de 10.

Definiciones (sobre las ejecuciones terminadas, es decir, no en curso):

- porcentaje_validos = Σ validos / Σ recuperados · 100
  Qué parte de lo que entrega Open Food Facts cumple las reglas mínimas
  (nombre, ingredientes utilizables, código de barras válido).
- porcentaje_duplicados = Σ duplicados / Σ validos · 100
  Qué parte de los válidos no aportó un producto nuevo. `duplicados` suma
  dos casos que se guardan por separado (ver DesgloseDuplicados): el mismo
  producto repetido en la ejecución (por ejemplo, en dos categorías) y el
  que ya estaba en la caché sin cambios. Con ingestas periódicas el
  segundo domina, y es esperable: indica que la caché ya estaba al día.
- cobertura_ingredientes = Σ con_ingredientes / Σ recuperados · 100
  Qué parte de lo recuperado traía al menos un ingrediente después de la
  limpieza; sin ingredientes no se pueden detectar alérgenos. Solo usa las
  ejecuciones que registraron ese conteo (las anteriores no lo tienen).

Sobre la caché:

- antiguedad_promedio_horas: promedio de horas desde la última vez que
  cada producto se confirmó contra la fuente (verificado_en).
- total_productos: productos válidos en la caché (los que se buscan).

Sin ejecuciones terminadas, las métricas de ingesta valen 0; las de la
caché se calculan igual (puede tener productos traídos con /products).
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional, Sequence, Tuple

from app.repositories.cache import EjecucionRegistrada
from app.schemas.metricas import MetricasCalidad

DECIMALES = 2


def porcentaje(parte: float, total: float) -> float:
    """parte / total · 100, redondeado; 0 si no hay total."""
    return round(100 * parte / total, DECIMALES) if total else 0.0


def calcular_metricas_calidad(
    ejecuciones: Sequence[EjecucionRegistrada],
    productos: Iterable[Tuple[bool, datetime]],
    ahora: datetime,
) -> MetricasCalidad:
    """`productos` son pares (es_valido, verificado_en) de la caché."""
    terminadas = [e for e in ejecuciones if e.resumen.estado != "en_curso"]
    recuperados = sum(e.resumen.recuperados for e in terminadas)
    validos = sum(e.resumen.validos for e in terminadas)
    duplicados = sum(e.resumen.duplicados for e in terminadas)
    con_detalle = [e for e in terminadas if e.detalle is not None]
    con_ingredientes = sum(e.detalle.con_ingredientes for e in con_detalle)
    base_cobertura = sum(e.resumen.recuperados for e in con_detalle)

    productos = list(productos)
    # max(0, ...) por si el reloj de quien verificó iba adelantado.
    horas = [max(0.0, (ahora - verificado).total_seconds() / 3600)
             for _, verificado in productos]
    return MetricasCalidad(
        porcentaje_validos=porcentaje(validos, recuperados),
        porcentaje_duplicados=porcentaje(duplicados, validos),
        cobertura_ingredientes=porcentaje(con_ingredientes, base_cobertura),
        antiguedad_promedio_horas=(
            round(sum(horas) / len(horas), DECIMALES) if horas else 0.0
        ),
        total_productos=sum(es_valido for es_valido, _ in productos),
    )


@dataclass(frozen=True)
class DesgloseDuplicados:
    """Los dos tipos que suma `duplicados` del contrato."""

    repetidos_en_ejecucion: int
    existentes_sin_cambios: int

    @property
    def total(self) -> int:
        return self.repetidos_en_ejecucion + self.existentes_sin_cambios


def desglose_duplicados(
    ejecuciones: Sequence[EjecucionRegistrada],
) -> DesgloseDuplicados:
    """Suma de las ejecuciones que registraron el detalle."""
    detalles = [e.detalle for e in ejecuciones if e.detalle is not None]
    return DesgloseDuplicados(
        repetidos_en_ejecucion=sum(d.repetidos_en_ejecucion
                                   for d in detalles),
        existentes_sin_cambios=sum(d.existentes_sin_cambios
                                   for d in detalles),
    )


@dataclass(frozen=True)
class FallasFuente:
    """Fallas de Open Food Facts en una ejecución.

    Cada petición es una página de /api/v2/search (con sus reintentos HTTP
    internos); una falla es una página que siguió fallando tras ellos y
    quedó en errores_fuente. Las categorías que fallan en la primera ronda
    se reintentan una vez: o se recuperan o se pierden (`errores`).
    """

    peticiones: int
    fallas: int  # filas en errores_fuente (de ambas rondas)
    recuperadas: int  # categorías que se recuperaron en el reintento
    perdidas: int  # categorías perdidas: `errores` del resumen

    @property
    def primera_ronda(self) -> int:
        return self.recuperadas + self.perdidas

    @property
    def en_reintento(self) -> int:
        return self.fallas - self.primera_ronda

    @property
    def tasa(self) -> float:
        """Porcentaje de peticiones que fallaron."""
        return porcentaje(self.fallas, self.peticiones)


def fallas_de_la_fuente(
    ejecucion: EjecucionRegistrada,
) -> Optional[FallasFuente]:
    """None si la ejecución no registró sus peticiones."""
    if ejecucion.detalle is None:
        return None
    return FallasFuente(
        peticiones=ejecucion.detalle.peticiones,
        fallas=ejecucion.fallas_registradas,
        recuperadas=ejecucion.detalle.fallas_recuperadas,
        perdidas=ejecucion.resumen.errores,
    )
