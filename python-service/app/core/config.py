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


settings = Settings()
