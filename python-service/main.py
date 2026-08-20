# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from pydantic import BaseModel

app = FastAPI(title="FoodAware AI Service")

class FoodItem(BaseModel):
    nombre: str
    ingredientes: list[str] = []

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "FoodAware Python Service"}

@app.post("/clasificar-alimento")
def clasificar_alimento(item: FoodItem):
    # Lógica mockeada para el MVP
    is_compatible = "azúcar" not in [i.lower() for i in item.ingredientes]
    
    return {
        "alimento": item.nombre,
        "compatible": is_compatible,
        "restriccion_detectada": "Ninguna" if is_compatible else "Contiene azúcar",
        "confidence": 0.95
    }
