import pytest


def analizar(client, ingredientes, nombre="Producto de prueba"):
    response = client.post(
        "/analizar", json={"nombre": nombre, "ingredientes": ingredientes}
    )
    assert response.status_code == 200
    return response.json()


def test_respuesta_completa_barrita(client):
    # Mismo caso que GET /api/food/test-ia en NestJS
    data = analizar(
        client, ["avena", "maní", "azúcar", "miel"], "Barrita energética"
    )
    assert data == {
        "producto": "Barrita energética",
        "veredicto": {
            "alergenos_detectados": ["maní"],
            "alto_en_azucar": True,
            "es_saludable": False,
        },
        "confianza_modelo": 0.95,
    }


@pytest.mark.parametrize(
    "ingredientes, esperado",
    [
        (["leche"], ["lácteos"]),
        (["lactosa"], ["lácteos"]),
        (["Leche"], ["lácteos"]),
        (["maní"], ["maní"]),
        (["mani"], ["maní"]),
        (["cacahuete"], ["maní"]),
        (["leche", "maní"], ["lácteos", "maní"]),
        (["avena", "miel"], []),
    ],
)
def test_deteccion_alergenos(client, ingredientes, esperado):
    data = analizar(client, ingredientes)
    assert data["veredicto"]["alergenos_detectados"] == esperado


def test_alergenos_requieren_coincidencia_exacta(client):
    # Comportamiento actual: "leche en polvo" no se detecta como lácteo
    data = analizar(client, ["leche en polvo"])
    assert data["veredicto"]["alergenos_detectados"] == []


@pytest.mark.parametrize(
    "ingrediente", ["azúcar", "azucar rubia", "jarabe de maíz"]
)
def test_alto_en_azucar(client, ingrediente):
    data = analizar(client, ["avena", ingrediente])
    assert data["veredicto"]["alto_en_azucar"] is True
    assert data["veredicto"]["es_saludable"] is False


def test_producto_saludable(client):
    data = analizar(client, ["avena", "almendras"])
    assert data["veredicto"] == {
        "alergenos_detectados": [],
        "alto_en_azucar": False,
        "es_saludable": True,
    }


def test_alergeno_sin_azucar_no_es_saludable(client):
    data = analizar(client, ["leche"])
    assert data["veredicto"]["alto_en_azucar"] is False
    assert data["veredicto"]["es_saludable"] is False


def test_marca_es_opcional(client):
    response = client.post(
        "/analizar",
        json={"nombre": "Yogur", "ingredientes": ["leche"], "marca": "X"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "payload",
    [
        {"nombre": "Sin ingredientes"},
        {"ingredientes": ["avena"]},
        {"nombre": "Tipo inválido", "ingredientes": "avena"},
    ],
)
def test_payload_invalido_devuelve_422(client, payload):
    response = client.post("/analizar", json=payload)
    assert response.status_code == 422
