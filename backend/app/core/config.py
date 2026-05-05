from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AI-CSGTS"
    environment: str = "dev"
    api_v1_prefix: str = "/api/v1"

    jwt_secret_key: str = "dev-secret-change-me"
    jwt_access_token_expire_minutes: int = 60

    # PostgreSQL is the primary database for this system.
    # (Optional) You can still run with SQLite by setting DATABASE_URL=sqlite:///./aicsgts_dev.db in backend/.env
    database_url: str = "postgresql+psycopg://aicsgts:aicsgts_password@localhost:5432/aicsgts"

    cors_origins: str = "http://localhost:5173"

    default_system_admin_email: str = "it.elias38@gmail.com"
    default_system_admin_password: str = "Shema@123"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 20
    smtp_from_email: str = "no-reply@aicsgts.local"
    resend_api_key: str = ""
    resend_from_email: str = ""
    otp_expire_minutes: int = 10
    # OTP is mandatory for login.
    login_require_otp: bool = True

    # Training: heartbeat gap (seconds) before an open learning session auto-pauses.
    training_stale_heartbeat_seconds: int = 30 * 60

    @field_validator("database_url", mode="after")
    @classmethod
    def resolve_sqlite_path(cls, v: str) -> str:
        """Anchor sqlite:///./*.db to the backend folder (next to .env), not the shell cwd."""
        prefix = "sqlite:///./"
        if v.startswith(prefix):
            backend_root = Path(__file__).resolve().parents[2]
            filename = v[len(prefix) :]
            absolute = (backend_root / filename).resolve()
            return f"sqlite:///{absolute.as_posix()}"
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
