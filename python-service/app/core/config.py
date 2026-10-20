from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración del servicio, leída de variables de entorno IA_*."""

    model_config = SettingsConfigDict(env_prefix="IA_", extra="ignore")

    app_name: str = "Analista de Alimentos FoodAware"
    service_name: str = "foodaware-ia"
    # Sin prefijo IA_: es el nombre documentado en .env.example.
    simular_errores_habilitado: bool = Field(
        False, validation_alias="SIMULAR_ERRORES_HABILITADO"
    )


settings = Settings()
