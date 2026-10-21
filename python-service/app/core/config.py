from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración del servicio, leída de variables de entorno IA_*."""

    model_config = SettingsConfigDict(env_prefix="IA_", extra="ignore")

    app_name: str = "Analista de Alimentos FoodAware"
    service_name: str = "foodaware-ia"
    # Las siguientes van sin prefijo IA_: son los nombres de .env.example.
    simular_errores_habilitado: bool = Field(
        False, validation_alias="SIMULAR_ERRORES_HABILITADO"
    )
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
    # En Docker apunta al volumen /data (ver docker-compose.yml).
    cache_db_path: str = Field(
        "data/foodaware-cache.sqlite3", validation_alias="CACHE_DB_PATH"
    )


settings = Settings()
