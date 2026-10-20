import pytest
from pydantic import ValidationError

from app.schemas.busqueda import RespuestaBusqueda
from app.schemas.ingesta import ResumenIngesta, SolicitudIngesta
from tests.test_schemas_producto import producto_valido

RUN_ID = "3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b"


def busqueda_valida(**cambios):
    datos = {
        "consulta": "leche",
        "total": 1,
        "tiempo_ms": 12.5,
        "resultados": [
            {"producto": producto_valido(), "score": 7.4, "posicion": 1}
        ],
        "estado_fuente": "online",
    }
    datos.update(cambios)
    return datos


def resumen_valido(**cambios):
    datos = {
        "run_id": RUN_ID,
        "inicio": "2026-10-20T14:00:00Z",
        "fin": "2026-10-20T14:02:30Z",
        "duracion_ms": 150000,
        "recuperados": 100,
        "validos": 92,
        "invalidos": 8,
        "duplicados": 5,
        "errores": 1,
        "estado": "completado_con_errores",
    }
    datos.update(cambios)
    return datos


def test_busqueda_valida():
    respuesta = RespuestaBusqueda.model_validate(busqueda_valida())
    assert respuesta.resultados[0].producto.codigo_barras == "7802800716999"


@pytest.mark.parametrize(
    "cambios",
    [
        {"consulta": "a"},
        {"consulta": "a" * 101},
        {"estado_fuente": "offline"},
        {"total": 0},
        {"tiempo_ms": -1},
        {"resultados": [{"producto": producto_valido(), "score": -1,
                         "posicion": 1}]},
        {"resultados": [{"producto": producto_valido(), "score": 1,
                         "posicion": 0}]},
    ],
)
def test_busqueda_invalida(cambios):
    with pytest.raises(ValidationError):
        RespuestaBusqueda.model_validate(busqueda_valida(**cambios))


def test_solicitud_ingesta_valores_por_defecto():
    solicitud = SolicitudIngesta()
    assert solicitud.pais == "chile"
    assert solicitud.categorias == []
    assert solicitud.max_productos == 100


@pytest.mark.parametrize("maximo", [1, 500])
def test_solicitud_ingesta_limites_validos(maximo):
    SolicitudIngesta(max_productos=maximo)


@pytest.mark.parametrize(
    "datos",
    [
        {"max_productos": 0},
        {"max_productos": 501},
        {"pais": "Chile"},
        {"pais": "c"},
        {"categorias": ["x"]},
        {"categorias": ["en:dairies"] * 21},
        {"campo_extra": True},
    ],
)
def test_solicitud_ingesta_invalida(datos):
    with pytest.raises(ValidationError):
        SolicitudIngesta.model_validate(datos)


def test_resumen_en_curso_sin_fin():
    ResumenIngesta.model_validate(
        resumen_valido(fin=None, duracion_ms=None, estado="en_curso")
    )


@pytest.mark.parametrize(
    "cambios",
    [
        {"fin": "2026-10-20T13:59:00Z"},
        {"fin": None},
        {"validos": 95},
        {"duplicados": 93},
        {"errores": -1},
        {"estado": "pausado"},
        {"inicio": "2026-10-20T14:00:00"},
    ],
)
def test_resumen_invalido(cambios):
    with pytest.raises(ValidationError):
        ResumenIngesta.model_validate(resumen_valido(**cambios))
