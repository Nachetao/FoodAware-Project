from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, AwareDatetime, Field


def _a_utc(valor: datetime) -> datetime:
    return valor.astimezone(timezone.utc)


# Exige zona horaria explícita y la normaliza a UTC.
FechaUTC = Annotated[AwareDatetime, AfterValidator(_a_utc)]

# EAN-8, UPC-A (12), EAN-13 o GTIN-14.
CodigoBarras = Annotated[
    str,
    Field(
        pattern=r"^\d{8,14}$",
        description="Código de barras de 8 a 14 dígitos.",
        examples=["7802800716999"],
    ),
]

Proporcion = Annotated[float, Field(ge=0, le=1)]
Porcentaje = Annotated[float, Field(ge=0, le=100)]
