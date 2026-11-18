"""Archivo de etiquetado manual: formato, validación y que sus productos
estén en la semilla (el corpus de staging)."""
import pytest

from app.evaluacion.etiquetado import (
    RUTA_ETIQUETADO,
    cargar_etiquetado,
    etiquetado_desde_dict,
    revisados,
)
from app.services import semilla


def producto(codigo="7802920000015", **manual):
    return {"codigo_barras": codigo, "nombre": "x",
            "manual": {"alergenos": [], "trazas": [],
                       "revisado_por_equipo": True, **manual}}


def test_el_archivo_versionado_es_valido():
    productos = cargar_etiquetado(RUTA_ETIQUETADO)

    assert len(productos) == 30
    assert len(revisados(productos)) == 30


def test_sus_productos_estan_en_la_semilla():
    codigos = {p["payload_off"]["code"] for p in
               semilla.leer_semilla(semilla.RUTA_SEMILLA)["productos"]}

    faltan = [p.codigo_barras for p in cargar_etiquetado()
              if p.codigo_barras not in codigos]
    assert faltan == []


def test_null_significa_sin_decidir():
    [sin_decidir] = etiquetado_desde_dict(
        {"productos": [producto(alergenos=None, trazas=["mani"])]})

    assert sin_decidir.alergenos is None
    assert sin_decidir.trazas == {"mani"}


def test_solo_cuentan_los_revisados():
    productos = etiquetado_desde_dict({"productos": [
        producto("7802920000015"),
        producto("7802920000022", revisado_por_equipo=False),
    ]})

    assert [p.codigo_barras for p in revisados(productos)] == [
        "7802920000015"]


@pytest.mark.parametrize("datos", [
    {"productos": [producto(alergenos=["leche"])]},
    {"productos": [producto(trazas=["nueces"])]},
    {"productos": [producto(revisado_por_equipo="si")]},
    {"productos": [producto(), producto()]},
])
def test_rechaza_un_archivo_mal_escrito(datos):
    with pytest.raises(ValueError):
        etiquetado_desde_dict(datos)
