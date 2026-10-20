from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.schemas.enums import AllergenCode, DietLabel
from app.schemas.tipos import CodigoBarras, FechaUTC, Proporcion


class Procedencia(BaseModel):
    """Trazabilidad del registro: de dónde y cuándo se obtuvo."""

    fuente: Literal["openfoodfacts"] = Field(
        "openfoodfacts",
        description="Fuente web de la que proviene el producto.",
        examples=["openfoodfacts"],
    )
    url_fuente: HttpUrl = Field(
        description="URL pública del producto en la fuente.",
        examples=["https://world.openfoodfacts.org/product/7802800716999"],
    )
    recuperado_en: FechaUTC = Field(
        description="Momento de la descarga; se normaliza a UTC.",
        examples=["2026-10-20T14:30:00Z"],
    )
    modificado_en_fuente: Optional[FechaUTC] = Field(
        None,
        description="Última modificación informada por la fuente, en UTC.",
        examples=["2026-09-02T08:15:00Z"],
    )
    run_id: UUID = Field(
        description="Ejecución de ingesta que obtuvo el registro.",
        examples=["3f2b8c1e-9d4a-4e7b-8a6f-1c2d3e4f5a6b"],
    )
    hash_contenido: str = Field(
        pattern=r"^[a-f0-9]{64}$",
        description="SHA-256 del contenido normalizado; sirve para "
        "detectar cambios y duplicados.",
        examples=["9f86d081884c7d659a2feaa0c55ad015"
                  "a3bf4f1b2b0b822cd15d6c15b0f00a08"],
    )


class Calidad(BaseModel):
    """Resultado de la validación del registro."""

    es_valido: bool = Field(
        description="Indica si el registro cumple las reglas mínimas.",
        examples=[True],
    )
    problemas: List[str] = Field(
        default_factory=list,
        description="Problemas detectados durante la validación.",
        examples=[["sin_ingredientes", "sin_imagen"]],
    )
    completitud: Proporcion = Field(
        description="Fracción de campos relevantes presentes (0 a 1).",
        examples=[0.85],
    )


class Producto(BaseModel):
    """Producto alimenticio normalizado."""

    model_config = ConfigDict(str_strip_whitespace=True)

    codigo_barras: CodigoBarras
    nombre: str = Field(
        min_length=1,
        max_length=300,
        description="Nombre comercial del producto.",
        examples=["Leche semidescremada"],
    )
    marca: Optional[str] = Field(
        None, max_length=200, description="Marca.", examples=["Colun"]
    )
    cantidad: Optional[str] = Field(
        None,
        max_length=50,
        description="Contenido neto tal como lo informa la fuente.",
        examples=["1 L"],
    )
    ingredientes_texto: Optional[str] = Field(
        None,
        max_length=5000,
        description="Lista de ingredientes original, sin procesar.",
        examples=["Leche semidescremada, vitaminas A y D3."],
    )
    ingredientes: List[str] = Field(
        default_factory=list,
        description="Ingredientes normalizados (minúsculas, sin "
        "espacios sobrantes).",
        examples=[["leche semidescremada", "vitamina a", "vitamina d3"]],
    )
    alergenos: List[AllergenCode] = Field(
        default_factory=list,
        description="Alérgenos presentes como ingrediente.",
        examples=[["lacteos"]],
    )
    trazas: List[AllergenCode] = Field(
        default_factory=list,
        description="Alérgenos que pueden estar presentes como trazas.",
        examples=[["frutos_secos"]],
    )
    etiquetas_dieta: List[DietLabel] = Field(
        default_factory=list,
        description="Dietas con las que el producto es compatible.",
        examples=[["vegetariano", "sin_gluten"]],
    )
    nutriscore: Optional[Literal["a", "b", "c", "d", "e"]] = Field(
        None, description="Nutri-Score en minúscula.", examples=["b"]
    )
    imagen_url: Optional[HttpUrl] = Field(
        None,
        description="Imagen principal del producto.",
        examples=["https://images.openfoodfacts.org/images/products/"
                  "780/280/071/6999/front_es.jpg"],
    )
    procedencia: Procedencia
    calidad: Calidad
