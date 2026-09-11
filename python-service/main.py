from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="Analista de Alimentos FoodAware")


class ProductoInput(BaseModel):
    nombre: str
    ingredientes: List[str]
    marca: Optional[str] = None


@app.get("/")
def read_root():
    return {"status": "Servicio FastAPI activo"}


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "foodaware-ia"}


@app.post("/analizar")
def analizar_producto(producto: ProductoInput):
    # Lógica simulada de análisis
    ingredientes_lower = [
        ing.lower() for ing in producto.ingredientes
    ]

    alergenos_detectados = []
    if ("leche" in ingredientes_lower
            or "lactosa" in ingredientes_lower):
        alergenos_detectados.append("lácteos")
    if ("maní" in ingredientes_lower
            or "mani" in ingredientes_lower
            or "cacahuete" in ingredientes_lower):
        alergenos_detectados.append("maní")

    alto_en_azucar = any(
        "azúcar" in ing
        or "azucar" in ing
        or "jarabe" in ing
        for ing in ingredientes_lower
    )

    return {
        "producto": producto.nombre,
        "veredicto": {
            "alergenos_detectados": alergenos_detectados,
            "alto_en_azucar": alto_en_azucar,
            "es_saludable": (
                not alto_en_azucar
                and len(alergenos_detectados) == 0
            ),
        },
        "confianza_modelo": 0.95,
    }
