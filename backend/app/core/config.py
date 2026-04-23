from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AI-CSGTS"
    environment: str = "dev"
    api_v1_prefix: str = "/api/v1"

    jwt_secret_key: str = "dev-secret-change-me"
    jwt_access_token_expire_minutes: int = 60

    # PostgreSQL is the primary database for this system.
    # (Optional) You can still run with SQLite by setting DATABASE_URL=sqlite:///./aicsgts_dev.db in backend/.env
    database_url: str = "postgresql+psycopg://aicsgts:aicsgts_password@localhost:5432/aicsgts"

    cors_origins: str = "http://localhost:5173"

    default_system_admin_email: str = "shema@gmail.com"
    default_system_admin_password: str = "Shema@123"

    # Training: heartbeat gap (seconds) before an open learning session auto-pauses.
    training_stale_heartbeat_seconds: int = 30 * 60

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
