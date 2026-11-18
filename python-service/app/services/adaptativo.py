"""POST /products/{codigo_barras}/compatibility y POST /search/personalized.

La búsqueda personalizada parte del ranking base (el mismo de GET /search),
le pone un veredicto a cada coincidencia, deja primero los aptos, después
los apto_con_advertencia y al final los no_apto (o los oculta), e informa
qué cambió respecto del ranking base.

Pendiente para la versión completa: interpretar las restricciones de la
consulta ("sin leche") y buscar sin ellas.
"""
import time
from typing import Dict, List, Tuple

from app.adaptativo.textos import contar_motivos, texto_no_aptos
from app.adaptativo.veredicto import evaluar_veredicto
from app.procesamiento.texto import tokenizar
from app.schemas.adaptativo import (
    ComparacionRanking,
    InterpretacionConsulta,
    PerfilRestricciones,
    RespuestaBusquedaPersonalizada,
    ResultadoPersonalizado,
    ResumenNoAptos,
    SalidaTop,
    SolicitudBusquedaPersonalizada,
    Veredicto,
)
from app.schemas.busqueda import ResultadoBusqueda
from app.services.busqueda import ServicioBusqueda
from app.services.catalogo import ServicioCatalogo

# Tamaño del top que se compara con el ranking base (el mismo K de la
# evaluación de la búsqueda).
K_COMPARACION = 5
_RANGO = {"apto": 0, "apto_con_advertencia": 1, "no_apto": 2}

Evaluado = Tuple[ResultadoBusqueda, Veredicto]


class ServicioAdaptativo:
    def __init__(self, catalogo: ServicioCatalogo,
                 busqueda: ServicioBusqueda) -> None:
        self._catalogo = catalogo
        self._busqueda = busqueda

    async def compatibilidad(self, codigo_barras: str,
                             perfil: PerfilRestricciones) -> Veredicto:
        producto = await self._catalogo.obtener_producto(codigo_barras)
        return evaluar_veredicto(producto, perfil)

    async def buscar_personalizada(
        self, solicitud: SolicitudBusquedaPersonalizada
    ) -> RespuestaBusquedaPersonalizada:
        inicio = time.perf_counter()
        perfil = solicitud.perfil
        # Todas las coincidencias: el filtro va antes de paginar.
        todas = max(1, len(self._busqueda.instantanea.productos))
        base = await self._busqueda.buscar(solicitud.consulta, todas, 0)

        evaluados: List[Evaluado] = [
            (r, evaluar_veredicto(r.producto, perfil)) for r in base.resultados
        ]
        ordenados = sorted(
            evaluados, key=lambda e: (_RANGO[e[1].veredicto], e[0].posicion)
        )
        no_aptos = [v for _, v in ordenados if v.veredicto == "no_apto"]
        ocultar = solicitud.modo == "filtrar"
        visibles = [e for e in ordenados
                    if not (ocultar and e[1].veredicto == "no_apto")]

        pagina = visibles[solicitud.offset:solicitud.offset + solicitud.limit]
        resultados = [
            ResultadoPersonalizado(
                producto=r.producto,
                score=r.score,
                posicion=solicitud.offset + i + 1,
                posicion_base=r.posicion,
                veredicto=v,
            )
            for i, (r, v) in enumerate(pagina)
        ]
        motivos = contar_motivos(v.motivos_no_apto for v in no_aptos)
        return RespuestaBusquedaPersonalizada(
            consulta=solicitud.consulta,
            interpretacion=InterpretacionConsulta(
                terminos=tokenizar(solicitud.consulta)
            ),
            perfil_aplicado=perfil,
            modo=solicitud.modo,
            total=len(visibles),
            total_base=base.total,
            tiempo_ms=round((time.perf_counter() - inicio) * 1000, 3),
            estado_fuente=base.estado_fuente,
            resultados=resultados,
            no_aptos=ResumenNoAptos(
                total=len(no_aptos),
                ocultos=ocultar,
                motivos=motivos,
                texto=texto_no_aptos(len(no_aptos), ocultar, motivos),
            ),
            comparacion=_comparar(base.resultados, visibles),
        )


def _comparar(base: List[ResultadoBusqueda],
              visibles: List[Evaluado]) -> ComparacionRanking:
    top_base = [r.producto.codigo_barras for r in base[:K_COMPARACION]]
    top_personalizado = [r.producto.codigo_barras
                         for r, _ in visibles[:K_COMPARACION]]
    posicion: Dict[str, int] = {
        r.producto.codigo_barras: i + 1 for i, (r, _) in enumerate(visibles)
    }
    veredicto: Dict[str, str] = {
        r.producto.codigo_barras: v.veredicto for r, v in visibles
    }
    salieron = [
        SalidaTop(
            codigo_barras=r.producto.codigo_barras,
            posicion_base=r.posicion,
            posicion=posicion.get(r.producto.codigo_barras),
            # Si no está entre los visibles, quedó oculto por no_apto.
            veredicto=veredicto.get(r.producto.codigo_barras, "no_apto"),
        )
        for r in base[:K_COMPARACION]
        if r.producto.codigo_barras not in top_personalizado
    ]
    return ComparacionRanking(
        k=K_COMPARACION,
        top_base=top_base,
        top_personalizado=top_personalizado,
        salieron_del_top=salieron,
        entraron_al_top=[c for c in top_personalizado if c not in top_base],
    )
