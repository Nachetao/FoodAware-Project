from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Mismo límite que SolicitudIngesta.categorias en el contrato.
MAX_CATEGORIAS = 20
NIVELES_LOG = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


class Settings(BaseSettings):
    """Configuración del servicio, leída de variables de entorno IA_*."""

    model_config = SettingsConfigDict(env_prefix="IA_", extra="ignore")

    app_name: str = "Analista de Alimentos FoodAware"
    # Las siguientes van sin prefijo IA_: son los nombres de .env.example.
    simular_errores_habilitado: bool = Field(
        False, validation_alias="SIMULAR_ERRORES_HABILITADO"
    )
    # Nivel mínimo de los logs JSON (ver app.core.logs).
    log_level: str = Field("INFO", validation_alias="LOG_LEVEL")
    off_base_url: str = Field(
        "https://world.openfoodfacts.org", validation_alias="OFF_BASE_URL"
    )
    # Obligatorio para llamar a Open Food Facts; lo valida el cliente.
    off_user_agent: Optional[str] = Field(
        None, validation_alias="OFF_USER_AGENT"
    )
    off_timeout_segundos: float = Field(
        10.0, gt=0, validation_alias="OFF_TIMEOUT_SEGUNDOS"
    )
    # Tope de espera del limitador en lecturas que vienen de una petición.
    limitador_espera_max_segundos: float = Field(
        3.0, ge=0, validation_alias="LIMITADOR_ESPERA_MAX_SEGUNDOS"
    )
    # En Docker apunta al volumen /data (ver docker-compose.yml).
    cache_db_path: str = Field(
        "data/foodaware-cache.sqlite3", validation_alias="CACHE_DB_PATH"
    )
    cache_ttl_horas: float = Field(
        72.0, gt=0, validation_alias="CACHE_TTL_HORAS"
    )
    ingesta_al_iniciar: bool = Field(
        True, validation_alias="INGESTA_AL_INICIAR"
    )
    ingesta_intervalo_horas: float = Field(
        24.0, gt=0, validation_alias="INGESTA_INTERVALO_HORAS"
    )
    # Categorías de OFF (taxonomía en:) de las ingestas automáticas,
    # separadas por comas. Se eligieron por ser relevantes para alergias:
    # galletas, lácteos, panes, chocolates, cereales, snacks salados y
    # bebidas vegetales. Vacío = sin filtrar por categoría.
    ingesta_categorias_texto: str = Field(
        "en:biscuits,en:dairies,en:breads,en:chocolates,"
        "en:breakfast-cereals,en:salty-snacks,"
        "en:plant-based-milk-alternatives",
        validation_alias="INGESTA_CATEGORIAS",
    )
    # Tope de productos por ingesta automática (500 es el máximo del
    # contrato de SolicitudIngesta); se reparte entre las categorías.
    ingesta_max_productos: int = Field(
        500, ge=1, le=500, validation_alias="INGESTA_MAX_PRODUCTOS"
    )

    @field_validator("log_level")
    @classmethod
    def _nivel_log_valido(cls, valor: str) -> str:
        nivel = valor.strip().upper()
        if nivel not in NIVELES_LOG:
            raise ValueError(
                f"LOG_LEVEL debe ser uno de: {', '.join(NIVELES_LOG)}"
            )
        return nivel

    @field_validator("ingesta_categorias_texto")
    @classmethod
    def _categorias_validas(cls, valor: str) -> str:
        categorias = _separar_por_comas(valor)
        if len(categorias) > MAX_CATEGORIAS:
            raise ValueError(
                f"INGESTA_CATEGORIAS admite hasta {MAX_CATEGORIAS} categorías"
            )
        if any(len(c) < 2 or len(c) > 100 for c in categorias):
            raise ValueError("cada categoría debe tener entre 2 y 100 "
                             "caracteres")
        return valor

    @property
    def ingesta_categorias(self) -> List[str]:
        return _separar_por_comas(self.ingesta_categorias_texto)


def _separar_por_comas(valor: str) -> List[str]:
    return list(dict.fromkeys(c.strip() for c in valor.split(",")
                              if c.strip()))


settings = Settings()
