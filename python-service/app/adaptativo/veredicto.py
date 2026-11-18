"""Veredicto de compatibilidad de un producto con un perfil de restricciones.

Reglas (la tabla está en docs/contratos/README.md, "Capacidad adaptativa"):

1. Alérgeno del perfil como ingrediente: no_apto.
2. Dieta contradicha por un alérgeno (vegano con lácteos, sin_gluten con
   gluten...): no_apto.
3. Traza de algo que el perfil evita: advertencia (no_apto en estricto).
4. Alérgeno posible (indicio sin confirmar): advertencia (no_apto en
   estricto).
5. Con alergias o dietas en el perfil, datos insuficientes: advertencia
   (no_apto en estricto).
6. Dieta que el producto no declara cumplir: advertencia.
7. Si no pasa nada de lo anterior: apto.

"Lo que el perfil evita" son sus alergias más los alérgenos que prohíben
sus dietas: una traza de gluten importa igual a quien sigue una dieta sin
gluten. El error más grave es un falso "apto", así que "apto" solo sale de
la fila 7. Funciones puras, sin acceso a la caché ni a la red.
"""
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Set, Tuple

from app.adaptativo.textos import enumerar, nombre
from app.procesamiento.calidad import INGREDIENTES_VACIOS, SIN_INGREDIENTES
from app.schemas.adaptativo import (
    Confianza,
    Conflicto,
    MotivoConfianza,
    MotivoNoApto,
    PerfilRestricciones,
    Veredicto,
)
from app.schemas.enums import AllergenCode, DietLabel
from app.schemas.producto import Producto

PREFIJO_ALERGENO_TEXTO = "alergeno_detectado_en_texto:"
PREFIJO_TRAZA_TEXTO = "traza_detectada_en_texto:"
PREFIJO_POSIBLE = "alergeno_posible:"
ALERGENOS_NO_RECONOCIDOS = "alergenos_no_reconocidos"

# Completitud desde la que la confianza es alta o media; bajo
# COMPLETITUD_MINIMA los datos no alcanzan para decidir (fila 5).
COMPLETITUD_ALTA = 0.8
COMPLETITUD_MINIMA = 0.5

_ANIMALES_MARINOS = frozenset({AllergenCode.pescado,
                               AllergenCode.crustaceos,
                               AllergenCode.moluscos})
# Alérgenos que contradicen cada dieta. sin_lactosa no tiene: un producto
# deslactosado lleva lácteos y aun así cumple la dieta, así que solo se
# confirma con la etiqueta (fila 6).
PROHIBIDOS_POR_DIETA: Dict[DietLabel, FrozenSet[AllergenCode]] = {
    DietLabel.vegano: _ANIMALES_MARINOS | {AllergenCode.lacteos,
                                           AllergenCode.huevo},
    DietLabel.vegetariano: _ANIMALES_MARINOS,
    DietLabel.sin_gluten: frozenset({AllergenCode.gluten}),
    DietLabel.sin_lactosa: frozenset(),
}

_NIVEL = {"alta": 2, "media": 1, "baja": 0}


@dataclass
class _Analisis:
    """Lo que se encontró al cruzar el producto con el perfil."""

    alergenos: List[AllergenCode] = field(default_factory=list)
    dietas_contradichas: List[Tuple[DietLabel, List[AllergenCode]]] = (
        field(default_factory=list))
    trazas: List[AllergenCode] = field(default_factory=list)
    posibles: List[AllergenCode] = field(default_factory=list)
    dietas_no_confirmadas: List[DietLabel] = field(default_factory=list)
    # Motivos por los que los datos no alcanzan (vacío si alcanzan).
    faltan_datos: List[MotivoConfianza] = field(default_factory=list)


def evaluar_veredicto(producto: Producto,
                      perfil: PerfilRestricciones) -> Veredicto:
    analisis = _analizar(producto, perfil)
    con_restricciones = bool(perfil.alergias or perfil.dietas)
    origen_alergeno = _origenes(producto, PREFIJO_ALERGENO_TEXTO)
    origen_traza = _origenes(producto, PREFIJO_TRAZA_TEXTO)

    conflictos = _conflictos(analisis, origen_alergeno, origen_traza)
    motivos_no_apto = _motivos_no_apto(analisis, perfil.modo_estricto,
                                       con_restricciones)
    hay_advertencia = bool(
        analisis.trazas or analisis.posibles
        or analisis.dietas_no_confirmadas
        or (con_restricciones and analisis.faltan_datos)
    )
    if motivos_no_apto:
        valor = "no_apto"
    elif hay_advertencia:
        valor = "apto_con_advertencia"
    else:
        valor = "apto"

    if valor == "no_apto":
        confianza, motivos_confianza = _confianza_no_apto(
            motivos_no_apto, conflictos, analisis)
    else:
        confianza, motivos_confianza = _confianza_general(
            producto, conflictos, analisis)

    return Veredicto(
        codigo_barras=producto.codigo_barras,
        veredicto=valor,
        alergenos_en_conflicto=analisis.alergenos,
        trazas_en_conflicto=analisis.trazas,
        dietas_no_confirmadas=analisis.dietas_no_confirmadas,
        conflictos=conflictos,
        motivos_no_apto=motivos_no_apto,
        datos_suficientes=not analisis.faltan_datos,
        explicacion=_explicacion(valor, analisis, perfil, motivos_no_apto),
        confianza=confianza,
        motivos_confianza=motivos_confianza,
    )


# --- análisis ----------------------------------------------------------------

def _analizar(producto: Producto,
              perfil: PerfilRestricciones) -> _Analisis:
    alergias = set(perfil.alergias)
    prohibidos_dietas: Set[AllergenCode] = set().union(
        *(PROHIBIDOS_POR_DIETA[d] for d in perfil.dietas))
    evita = alergias | prohibidos_dietas
    analisis = _Analisis()

    analisis.alergenos = [a for a in producto.alergenos if a in alergias]
    for dieta in perfil.dietas:
        contradicen = [a for a in producto.alergenos
                       if a in PROHIBIDOS_POR_DIETA[dieta]]
        if contradicen:
            analisis.dietas_contradichas.append((dieta, contradicen))
        elif dieta not in producto.etiquetas_dieta:
            analisis.dietas_no_confirmadas.append(dieta)

    # Una traza o un indicio de algo que ya es ingrediente no agrega nada.
    presentes = set(producto.alergenos)
    analisis.trazas = [t for t in producto.trazas
                       if t in evita and t not in presentes]
    posibles = _origenes(producto, PREFIJO_POSIBLE)
    analisis.posibles = [a for a in AllergenCode
                         if a in posibles and a in evita
                         and a not in presentes]
    analisis.faltan_datos = _faltan_datos(producto)
    return analisis


def _faltan_datos(producto: Producto) -> List[MotivoConfianza]:
    problemas = set(producto.calidad.problemas)
    motivos: List[MotivoConfianza] = []
    if (not producto.ingredientes or SIN_INGREDIENTES in problemas
            or INGREDIENTES_VACIOS in problemas):
        motivos.append("sin_ingredientes")
    if ALERGENOS_NO_RECONOCIDOS in problemas:
        motivos.append("alergenos_no_reconocidos")
    if producto.calidad.completitud < COMPLETITUD_MINIMA:
        motivos.append("completitud_baja")
    return motivos


def _origenes(producto: Producto, prefijo: str) -> Set[AllergenCode]:
    """Códigos de los problemas con ese prefijo (p. ej. los alérgenos que
    solo se detectaron en el texto)."""
    codigos = set()
    for problema in producto.calidad.problemas:
        if problema.startswith(prefijo):
            try:
                codigos.add(AllergenCode(problema[len(prefijo):]))
            except ValueError:
                continue
    return codigos


def _origen(codigo: AllergenCode, solo_texto: Set[AllergenCode]) -> str:
    return "texto" if codigo in solo_texto else "fuente"


def _conflictos(analisis: _Analisis, origen_alergeno: Set[AllergenCode],
                origen_traza: Set[AllergenCode]) -> List[Conflicto]:
    conflictos = [
        Conflicto(codigo=a, tipo="alergeno",
                  origen=_origen(a, origen_alergeno))
        for a in analisis.alergenos
    ]
    for dieta, contradicen in analisis.dietas_contradichas:
        # Basta un alérgeno declarado por la fuente para que la
        # contradicción venga de la fuente.
        de_la_fuente = any(a not in origen_alergeno for a in contradicen)
        conflictos.append(Conflicto(
            codigo=dieta, tipo="dieta",
            origen="fuente" if de_la_fuente else "texto"))
    conflictos += [
        Conflicto(codigo=t, tipo="traza", origen=_origen(t, origen_traza))
        for t in analisis.trazas
    ]
    conflictos += [
        Conflicto(codigo=p, tipo="posible", origen="indicio")
        for p in analisis.posibles
    ]
    return conflictos


def _motivos_no_apto(analisis: _Analisis, estricto: bool,
                     con_restricciones: bool) -> List[MotivoNoApto]:
    motivos = [MotivoNoApto(tipo="alergeno", codigo=a)
               for a in analisis.alergenos]
    motivos += [MotivoNoApto(tipo="dieta", codigo=d)
                for d, _ in analisis.dietas_contradichas]
    if estricto:
        motivos += [MotivoNoApto(tipo="traza", codigo=t)
                    for t in analisis.trazas]
        motivos += [MotivoNoApto(tipo="posible", codigo=p)
                    for p in analisis.posibles]
        if con_restricciones and analisis.faltan_datos:
            motivos.append(MotivoNoApto(tipo="datos_insuficientes"))
    return motivos


# --- confianza ---------------------------------------------------------------

def _confianza_no_apto(
    motivos: List[MotivoNoApto], conflictos: List[Conflicto],
    analisis: _Analisis,
) -> Tuple[Confianza, List[MotivoConfianza]]:
    """Depende de lo que decidió el no_apto: alta si la fuente lo declara,
    media si solo lo detectamos en el texto, baja si es un indicio o faltan
    datos."""
    decisivos = {(m.tipo, m.codigo) for m in motivos}
    origenes = {c.origen for c in conflictos
                if (c.tipo, c.codigo) in decisivos}
    if "fuente" in origenes:
        return "alta", []
    if "texto" in origenes:
        return "media", ["conflicto_solo_en_texto"]
    if "indicio" in origenes:
        return "baja", ["indicio_sin_confirmar"]
    return "baja", list(analisis.faltan_datos)


def _confianza_general(
    producto: Producto, conflictos: List[Conflicto], analisis: _Analisis,
) -> Tuple[Confianza, List[MotivoConfianza]]:
    """El nivel más bajo entre la completitud, los datos que faltan y el
    origen de los conflictos."""
    factores: List[Tuple[Confianza, MotivoConfianza]] = []
    completitud = producto.calidad.completitud
    if completitud < COMPLETITUD_MINIMA:
        factores.append(("baja", "completitud_baja"))
    elif completitud < COMPLETITUD_ALTA:
        factores.append(("media", "completitud_media"))
    factores += [("baja", m) for m in analisis.faltan_datos
                 if m != "completitud_baja"]
    origenes = {c.origen for c in conflictos}
    if "texto" in origenes:
        factores.append(("media", "conflicto_solo_en_texto"))
    if "indicio" in origenes:
        factores.append(("baja", "indicio_sin_confirmar"))

    if not factores:
        return "alta", []
    nivel = min((f for f, _ in factores), key=_NIVEL.__getitem__)
    return nivel, list(dict.fromkeys(m for _, m in factores))


# --- explicación -------------------------------------------------------------

_RAZONES_DATOS = {
    "sin_ingredientes": "no tiene lista de ingredientes",
    "alergenos_no_reconocidos": "declara alérgenos que no reconocemos",
    "completitud_baja": "su ficha está muy incompleta",
}


def _nombres(codigos) -> str:
    return enumerar(nombre(c) for c in codigos)


def _dietas(dietas: List[DietLabel]) -> str:
    if len(dietas) == 1:
        return f"la dieta {nombre(dietas[0])}"
    return f"las dietas {_nombres(dietas)}"


def _explicacion(valor: str, analisis: _Analisis,
                 perfil: PerfilRestricciones,
                 motivos_no_apto: List[MotivoNoApto]) -> str:
    if valor == "apto":
        if not (perfil.alergias or perfil.dietas):
            return ("Tu perfil no tiene alergias ni dietas, así que no hay "
                    "restricciones que revisar.")
        frase = ("No encontramos ninguno de tus alérgenos como ingrediente, "
                 "como traza ni como indicio.")
        if perfil.dietas:
            frase += f" Declara cumplir {_dietas(perfil.dietas)}."
        return frase

    frases: List[str] = []
    tipos = {m.tipo for m in motivos_no_apto}
    if analisis.alergenos:
        frases.append(
            f"Contiene {_nombres(analisis.alergenos)}, que "
            f"{'está' if len(analisis.alergenos) == 1 else 'están'} en tu "
            "perfil.")
    for dieta, contradicen in analisis.dietas_contradichas:
        frases.append(f"No cumple la dieta {nombre(dieta)}: contiene "
                      f"{_nombres(contradicen)}.")
    estricto = " (modo estricto)" if valor == "no_apto" else ""
    # En un no_apto por alérgeno o dieta, las advertencias en modo normal
    # no agregan nada a la explicación.
    con_advertencias = valor != "no_apto" or bool(
        tipos & {"traza", "posible", "datos_insuficientes"})
    if con_advertencias and analisis.trazas:
        frases.append(f"Puede contener trazas de "
                      f"{_nombres(analisis.trazas)}{estricto}.")
    if con_advertencias and analisis.posibles:
        frases.append(
            f"Podría contener {_nombres(analisis.posibles)}: tiene un "
            "ingrediente que suele venir de ahí y no declara su origen"
            f"{estricto}.")
    if (con_advertencias and analisis.faltan_datos
            and (perfil.alergias or perfil.dietas)):
        razones = enumerar(_RAZONES_DATOS[m] for m in analisis.faltan_datos)
        frases.append(f"No podemos revisarlo bien: {razones}{estricto}.")
    if valor != "no_apto" and analisis.dietas_no_confirmadas:
        frases.append(f"No declara cumplir "
                      f"{_dietas(analisis.dietas_no_confirmadas)}.")
    return " ".join(frases)
