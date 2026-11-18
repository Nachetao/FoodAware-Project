"""POST /products/{codigo_barras}/compatibility y POST /search/personalized.

La búsqueda personalizada:

1. Interpreta las restricciones de la consulta ("chocolate sin leche") y las
   suma al perfil solo para esta búsqueda (app.adaptativo.consulta).
2. Busca con BM25 la consulta sin esas restricciones ("chocolate"), con
   todas las coincidencias: el filtro va antes de paginar. Si la consulta
   solo traía restricciones ("sin gluten"), busca la consulta completa.
3. Le pone un veredicto a cada producto con el perfil aplicado y ordena por
   veredicto (apto, apto_con_advertencia, no_apto) y después por score.
4. En modo filtrar oculta los no_apto; en reordenar quedan al final.
5. Compara su top con el de GET /search con la consulta original, que es la
   versión no adaptativa y no cambia.
"""
import time
from typing import Dict, List, Tuple

from app.adaptativo.consulta import interpretar
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
        consulta = interpretar(solicitud.consulta)
        perfil = consulta.aplicar(solicitud.perfil)
        texto = (consulta.texto_busqueda
                 if tokenizar(consulta.texto_busqueda) else solicitud.consulta)

        instantanea = self._busqueda.instantanea
        todas = max(1, len(instantanea.productos))
        # Ranking base: exactamente GET /search con la consulta original.
        base = await self._busqueda.buscar(solicitud.consulta, todas, 0)
        _, coincidencias = instantanea.buscar(texto, todas, 0)

        evaluados: List[Evaluado] = [
            (r, evaluar_veredicto(r.producto, perfil)) for r in coincidencias
        ]
        # sorted es estable y las coincidencias ya vienen por score.
        ordenados = sorted(evaluados, key=lambda e: _RANGO[e[1].veredicto])
        no_aptos = [v for _, v in ordenados if v.veredicto == "no_apto"]
        ocultar = solicitud.modo == "filtrar"
        visibles = [e for e in ordenados
                    if not (ocultar and e[1].veredicto == "no_apto")]

        posicion_base = {r.producto.codigo_barras: r.posicion
                         for r in base.resultados}
        pagina = visibles[solicitud.offset:solicitud.offset + solicitud.limit]
        resultados = [
            ResultadoPersonalizado(
                producto=r.producto,
                score=r.score,
                posicion=solicitud.offset + i + 1,
                posicion_base=posicion_base.get(r.producto.codigo_barras),
                veredicto=v,
            )
            for i, (r, v) in enumerate(pagina)
        ]
        motivos = contar_motivos(v.motivos_no_apto for v in no_aptos)
        return RespuestaBusquedaPersonalizada(
            consulta=solicitud.consulta,
            interpretacion=InterpretacionConsulta(
                terminos=tokenizar(texto),
                restricciones=consulta.restricciones,
                no_reconocidas=consulta.no_reconocidas,
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
            comparacion=_comparar(base.resultados, visibles, perfil),
        )


def _comparar(base: List[ResultadoBusqueda], visibles: List[Evaluado],
              perfil: PerfilRestricciones) -> ComparacionRanking:
    top_base = base[:K_COMPARACION]
    top_personalizado = [r.producto.codigo_barras
                         for r, _ in visibles[:K_COMPARACION]]
    posicion: Dict[str, int] = {
        r.producto.codigo_barras: i + 1 for i, (r, _) in enumerate(visibles)
    }
    salieron = [
        SalidaTop(
            codigo_barras=r.producto.codigo_barras,
            posicion_base=r.posicion,
            # Nulo si quedó oculto o si no coincide con la consulta sin
            # restricciones.
            posicion=posicion.get(r.producto.codigo_barras),
            veredicto=evaluar_veredicto(r.producto, perfil).veredicto,
        )
        for r in top_base
        if r.producto.codigo_barras not in top_personalizado
    ]
    codigos_base = [r.producto.codigo_barras for r in top_base]
    return ComparacionRanking(
        k=K_COMPARACION,
        top_base=codigos_base,
        top_personalizado=top_personalizado,
        salieron_del_top=salieron,
        entraron_al_top=[c for c in top_personalizado
                         if c not in codigos_base],
    )
