from typing import List, Optional

from pydantic import BaseModel


class ProductoInput(BaseModel):
    nombre: str
    ingredientes: List[str]
    marca: Optional[str] = None
