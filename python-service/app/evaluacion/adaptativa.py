"""Evaluación de la capacidad adaptativa contra la versión base.

Tres mediciones, todas sobre el índice que está respondiendo:

1. Veredictos contra el etiquetado manual (etiquetado_manual.json, solo
   los productos revisados por el equipo). Para cada perfil de prueba y
   modo, el veredicto esperado sale de las etiquetas con las mismas reglas
   del veredicto, pero sin mirar la detección del sistema:

   - no_apto: el producto contiene algo que el perfil evita (sus alergias
     o los alérgenos que prohíben sus dietas);
   - si no, con una traza de algo que evita: apto_con_advertencia en modo
     normal y no_apto en estricto;
   - si no, apto.

   - Falso "apto" (el error más grave): el sistema dice apto y el producto
     contiene algo que el perfil evita. Tasa = falsos apto / productos que
     lo contienen. Solo necesita manual.alergenos.
   - Falso "apto" por traza: el sistema dice apto, el producto no lo
     contiene, pero el etiquetado tiene una traza de algo que el perfil
     evita. Necesita también manual.trazas.
   - Falso "no apto": el sistema dice no_apto y el veredicto esperado no
     lo es. Tasa = falsos no apto / productos cuyo esperado no es no_apto.
   - Matriz de confusión: veredicto esperado contra el del sistema.
   Un campo en null deja fuera al producto solo de los cálculos que lo
   necesitan. Que el sistema diga apto_con_advertencia cuando se esperaba
   apto no es un error: es la regla de "ante la duda, advertir" (por
   ejemplo, una dieta sin la etiqueta que la confirme).

2. Detección de alérgenos contra el etiquetado: precisión y exhaustividad
   (micro, contando pares producto-alérgeno) de `alergenos` y de `trazas`
   (las trazas del sistema sin las que ya son ingrediente, la misma regla
   del etiquetado). Los alérgenos posibles (lecitina sin origen) no
   cuentan: no son una afirmación de que el alérgeno esté.

3. Búsqueda base (GET /search) contra personalizada (POST
   /search/personalized, perfil vacío y modo filtrar) en las consultas con
   restricción del conjunto de evaluación: Precision@K con las reglas de
   consultas.json y cuántos productos del top K son no_apto para la
   restricción de la consulta. Ojo: tanto esas reglas como el veredicto
   usan la detección del sistema, así que esta parte mide el ranking dada
   la detección; la seguridad de la detección la mide la parte 1.
"""
from dataclasses import dataclass
from typing import (
    Any,
    Dict,
    FrozenSet,
    List,
    Mapping,
    Optional,
    Sequence,
    Set,
    Tuple,
)

from app.adaptativo.ranking import rankear
from app.adaptativo.veredicto import PROHIBIDOS_POR_DIETA, evaluar_veredicto
from app.busqueda.buscador import Instantanea
from app.evaluacion.conjunto import (
    ConjuntoEvaluacion,
    ConsultaEvaluacion,
    relevantes,
)
from app.evaluacion.etiquetado import ProductoEtiquetado, revisados
from app.evaluacion.evaluador import K_POR_DEFECTO
from app.evaluacion.metricas import precision_at_k, promedio_macro
from app.schemas.adaptativo import PerfilRestricciones
from app.schemas.enums import AllergenCode, DietLabel
from app.schemas.producto import Producto

MODOS = ("normal", "estricto")
VEREDICTOS = ("apto", "apto_con_advertencia", "no_apto")
PERFILES_PRUEBA: Tuple[Tuple[str, PerfilRestricciones], ...] = (
    ("alergia a lácteos",
     PerfilRestricciones(alergias=[AllergenCode.lacteos])),
    ("alergia al gluten",
     PerfilRestricciones(alergias=[AllergenCode.gluten])),
    ("alergia al maní", PerfilRestricciones(alergias=[AllergenCode.mani])),
    ("alergia a la soya",
     PerfilRestricciones(alergias=[AllergenCode.soya])),
    ("alergia a frutos secos",
     PerfilRestricciones(alergias=[AllergenCode.frutos_secos])),
    ("dieta vegana", PerfilRestricciones(dietas=[DietLabel.vegano])),
)

Registro = Tuple[Producto, Optional[Mapping[str, Any]]]


# --- resultados --------------------------------------------------------------

@dataclass(frozen=True)
class EvaluacionPerfil:
    perfil: str
    modo: str
    productos: int  # con manual.alergenos
    contienen: int  # contienen algo que el perfil evita
    falsos_apto: Tuple[str, ...]  # códigos
    falsos_apto_por_traza: Tuple[str, ...]
    productos_completos: int  # con veredicto esperado conocido
    no_deberian_ser_no_apto: int  # esperado distinto de no_apto
    falsos_no_apto: Tuple[str, ...]
    coincidencias: int  # sistema igual al esperado
    matriz: Mapping[str, Mapping[str, int]]  # esperado -> sistema -> n

    @property
    def tasa_falsos_apto(self) -> Optional[float]:
        return _tasa(len(self.falsos_apto), self.contienen)

    @property
    def tasa_falsos_no_apto(self) -> Optional[float]:
        return _tasa(len(self.falsos_no_apto),
                     self.no_deberian_ser_no_apto)


@dataclass(frozen=True)
class DiferenciaDeteccion:
    codigo_barras: str
    nombre: str
    falsos_positivos: Tuple[str, ...]  # el sistema lo marca y no está
    falsos_negativos: Tuple[str, ...]  # está y el sistema no lo marca


@dataclass(frozen=True)
class DeteccionCampo:
    productos: int
    verdaderos_positivos: int
    falsos_positivos: int
    falsos_negativos: int
    diferencias: Tuple[DiferenciaDeteccion, ...]

    @property
    def precision(self) -> Optional[float]:
        return _tasa(self.verdaderos_positivos,
                     self.verdaderos_positivos + self.falsos_positivos)

    @property
    def exhaustividad(self) -> Optional[float]:
        return _tasa(self.verdaderos_positivos,
                     self.verdaderos_positivos + self.falsos_negativos)


@dataclass(frozen=True)
class ComparacionConsulta:
    consulta: ConsultaEvaluacion
    relevantes: int  # en todo el corpus
    top_base: Tuple[str, ...]
    top_personalizado: Tuple[str, ...]
    precision_base: float
    precision_personalizada: float
    no_aptos_top_base: int
    no_aptos_top_personalizado: int

    @property
    def evaluada(self) -> bool:
        return self.relevantes > 0


@dataclass(frozen=True)
class ResultadoEvaluacionAdaptativa:
    k: int
    revisados: int
    no_encontrados: Tuple[str, ...]  # revisados que no están en el índice
    deteccion_alergenos: DeteccionCampo
    deteccion_trazas: DeteccionCampo
    perfiles: Tuple[EvaluacionPerfil, ...]
    consultas: Tuple[ComparacionConsulta, ...]

    @property
    def evaluados(self) -> int:
        return self.revisados - len(self.no_encontrados)

    @property
    def consultas_evaluadas(self) -> List[ComparacionConsulta]:
        return [c for c in self.consultas if c.evaluada]

    @property
    def precision_base(self) -> float:
        return promedio_macro([c.precision_base
                               for c in self.consultas_evaluadas])

    @property
    def precision_personalizada(self) -> float:
        return promedio_macro([c.precision_personalizada
                               for c in self.consultas_evaluadas])

    @property
    def no_aptos_top_base(self) -> int:
        return sum(c.no_aptos_top_base for c in self.consultas)

    @property
    def no_aptos_top_personalizado(self) -> int:
        return sum(c.no_aptos_top_personalizado for c in self.consultas)


# --- evaluación --------------------------------------------------------------

def evaluar_adaptativa(
    etiquetado: Sequence[ProductoEtiquetado],
    conjunto: ConjuntoEvaluacion,
    registros: Sequence[Registro],
    instantanea: Instantanea,
    k: int = K_POR_DEFECTO,
    perfiles: Sequence[Tuple[str, PerfilRestricciones]] = PERFILES_PRUEBA,
) -> ResultadoEvaluacionAdaptativa:
    """`registros` aporta el payload (las categorías) para las reglas de
    relevancia; los productos son los del índice."""
    etiquetados = revisados(list(etiquetado))
    productos = instantanea.productos
    encontrados = [(e, productos[e.codigo_barras]) for e in etiquetados
                   if e.codigo_barras in productos]
    no_encontrados = tuple(e.codigo_barras for e in etiquetados
                           if e.codigo_barras not in productos)
    return ResultadoEvaluacionAdaptativa(
        k=k,
        revisados=len(etiquetados),
        no_encontrados=no_encontrados,
        deteccion_alergenos=_deteccion(encontrados, "alergenos"),
        deteccion_trazas=_deteccion(encontrados, "trazas"),
        perfiles=tuple(
            _evaluar_perfil(nombre, perfil, modo, encontrados)
            for nombre, perfil in perfiles for modo in MODOS
        ),
        consultas=tuple(_comparar_busquedas(conjunto, registros,
                                            instantanea, k)),
    )


def evita(perfil: PerfilRestricciones) -> FrozenSet[AllergenCode]:
    """Alergias del perfil más los alérgenos que prohíben sus dietas."""
    prohibidos: Set[AllergenCode] = set(perfil.alergias)
    for dieta in perfil.dietas:
        prohibidos |= PROHIBIDOS_POR_DIETA[dieta]
    return frozenset(prohibidos)


def veredicto_esperado(etiqueta: ProductoEtiquetado,
                       perfil: PerfilRestricciones) -> Optional[str]:
    """Veredicto según el etiquetado manual; None si falta un dato."""
    evitados = evita(perfil)
    if etiqueta.alergenos is None:
        return None
    if etiqueta.alergenos & evitados:
        return "no_apto"
    if etiqueta.trazas is None:
        return None
    if etiqueta.trazas & evitados:
        return "no_apto" if perfil.modo_estricto else "apto_con_advertencia"
    return "apto"


def _evaluar_perfil(
    nombre: str, perfil: PerfilRestricciones, modo: str,
    encontrados: Sequence[Tuple[ProductoEtiquetado, Producto]],
) -> EvaluacionPerfil:
    perfil = perfil.model_copy(update={"modo_estricto": modo == "estricto"})
    evitados = evita(perfil)
    matriz: Dict[str, Dict[str, int]] = {
        esperado: {sistema: 0 for sistema in VEREDICTOS}
        for esperado in VEREDICTOS
    }
    productos = contienen = completos = no_deberian = coincidencias = 0
    falsos_apto: List[str] = []
    por_traza: List[str] = []
    falsos_no_apto: List[str] = []
    for etiqueta, producto in encontrados:
        sistema = evaluar_veredicto(producto, perfil).veredicto
        codigo = etiqueta.codigo_barras
        if etiqueta.alergenos is not None:
            productos += 1
            contiene = bool(etiqueta.alergenos & evitados)
            contienen += contiene
            if contiene and sistema == "apto":
                falsos_apto.append(codigo)
            elif (sistema == "apto" and etiqueta.trazas is not None
                  and etiqueta.trazas & evitados):
                por_traza.append(codigo)
        esperado = veredicto_esperado(etiqueta, perfil)
        if esperado is None:
            continue
        completos += 1
        matriz[esperado][sistema] += 1
        coincidencias += sistema == esperado
        if esperado != "no_apto":
            no_deberian += 1
            if sistema == "no_apto":
                falsos_no_apto.append(codigo)
    return EvaluacionPerfil(
        perfil=nombre, modo=modo, productos=productos, contienen=contienen,
        falsos_apto=tuple(falsos_apto), falsos_apto_por_traza=tuple(por_traza),
        productos_completos=completos, no_deberian_ser_no_apto=no_deberian,
        falsos_no_apto=tuple(falsos_no_apto), coincidencias=coincidencias,
        matriz=matriz,
    )


def _deteccion(encontrados: Sequence[Tuple[ProductoEtiquetado, Producto]],
               campo: str) -> DeteccionCampo:
    productos = vp = fp = fn = 0
    diferencias = []
    for etiqueta, producto in encontrados:
        manual = getattr(etiqueta, campo)
        if manual is None:
            continue
        sistema = set(producto.alergenos)
        if campo == "trazas":
            sistema = set(producto.trazas) - set(producto.alergenos)
        productos += 1
        de_mas = sistema - manual
        de_menos = manual - sistema
        vp += len(sistema & manual)
        fp += len(de_mas)
        fn += len(de_menos)
        if de_mas or de_menos:
            diferencias.append(DiferenciaDeteccion(
                codigo_barras=etiqueta.codigo_barras,
                nombre=etiqueta.nombre,
                falsos_positivos=tuple(sorted(c.value for c in de_mas)),
                falsos_negativos=tuple(sorted(c.value for c in de_menos)),
            ))
    return DeteccionCampo(productos=productos, verdaderos_positivos=vp,
                          falsos_positivos=fp, falsos_negativos=fn,
                          diferencias=tuple(diferencias))


def _comparar_busquedas(
    conjunto: ConjuntoEvaluacion, registros: Sequence[Registro],
    instantanea: Instantanea, k: int,
) -> List[ComparacionConsulta]:
    corpus = [(p, payload) for p, payload in registros
              if p.codigo_barras in instantanea.productos]
    comparaciones = []
    for consulta in conjunto.consultas:
        if consulta.tipo != "restriccion":
            continue
        relevantes_ = relevantes(consulta.regla, corpus)
        _, pagina = instantanea.buscar(consulta.consulta, k, 0)
        top_base = tuple(r.producto.codigo_barras for r in pagina)
        # Perfil vacío: la restricción sale de la consulta, como la escribe
        # una persona que no inició sesión.
        ranking = rankear(instantanea, consulta.consulta,
                          PerfilRestricciones())
        visibles = ranking.visibles("filtrar")[:k]
        top_personalizado = tuple(r.producto.codigo_barras
                                  for r, _ in visibles)
        comparaciones.append(ComparacionConsulta(
            consulta=consulta,
            relevantes=len(relevantes_),
            top_base=top_base,
            top_personalizado=top_personalizado,
            precision_base=precision_at_k(top_base, relevantes_, k),
            precision_personalizada=precision_at_k(top_personalizado,
                                                   relevantes_, k),
            no_aptos_top_base=sum(
                evaluar_veredicto(instantanea.productos[c],
                                  ranking.perfil).veredicto == "no_apto"
                for c in top_base),
            no_aptos_top_personalizado=sum(
                v.veredicto == "no_apto" for _, v in visibles),
        ))
    return comparaciones


def _tasa(parte: int, total: int) -> Optional[float]:
    """parte / total; None si no hay total (la tasa no está definida)."""
    return parte / total if total else None
