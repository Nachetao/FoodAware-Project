"""Veredicto de compatibilidad de un producto con un perfil de restricciones.

Versión preliminar: aplica las dos primeras reglas (alérgeno y traza en
conflicto) y, en cualquier otro caso, responde apto_con_advertencia. Nunca
responde "apto" mientras no estén todas las reglas.
"""
from typing import List

from app.adaptativo.textos import enumerar, nombre
from app.schemas.adaptativo import (
    Conflicto,
    MotivoNoApto,
    PerfilRestricciones,
    Veredicto,
)
from app.schemas.enums import AllergenCode
from app.schemas.producto import Producto

PREFIJO_ALERGENO_TEXTO = "alergeno_detectado_en_texto:"
PREFIJO_TRAZA_TEXTO = "traza_detectada_en_texto:"


def _solo_en_texto(producto: Producto, prefijo: str) -> set:
    return {p[len(prefijo):] for p in producto.calidad.problemas
            if p.startswith(prefijo)}


def _conflictos(producto: Producto, codigos: List[AllergenCode], tipo: str,
                prefijo: str) -> List[Conflicto]:
    en_texto = _solo_en_texto(producto, prefijo)
    return [Conflicto(codigo=c, tipo=tipo,
                      origen="texto" if c.value in en_texto else "fuente")
            for c in codigos]


def evaluar_veredicto(producto: Producto,
                      perfil: PerfilRestricciones) -> Veredicto:
    alergias = set(perfil.alergias)
    alergenos = [a for a in producto.alergenos if a in alergias]
    trazas = [t for t in producto.trazas if t in alergias]
    conflictos = (
        _conflictos(producto, alergenos, "alergeno", PREFIJO_ALERGENO_TEXTO)
        + _conflictos(producto, trazas, "traza", PREFIJO_TRAZA_TEXTO)
    )
    solo_texto = any(c.origen == "texto" for c in conflictos)

    if alergenos:
        valor = "no_apto"
        explicacion = (f"Contiene {enumerar(nombre(a) for a in alergenos)}, "
                       "que está en tu perfil.")
    elif trazas:
        valor = "apto_con_advertencia"
        explicacion = (f"Puede contener trazas de "
                       f"{enumerar(nombre(t) for t in trazas)}.")
    else:
        valor = "apto_con_advertencia"
        explicacion = ("Veredicto preliminar: no encontramos alérgenos de tu "
                       "perfil, pero todavía no revisamos las dietas ni la "
                       "calidad de los datos.")

    return Veredicto(
        codigo_barras=producto.codigo_barras,
        veredicto=valor,
        alergenos_en_conflicto=alergenos,
        trazas_en_conflicto=trazas,
        conflictos=conflictos,
        motivos_no_apto=[MotivoNoApto(tipo="alergeno", codigo=a)
                         for a in alergenos],
        datos_suficientes=bool(producto.ingredientes),
        explicacion=explicacion,
        confianza="media" if solo_texto else "alta",
        motivos_confianza=["conflicto_solo_en_texto"] if solo_texto else [],
    )
