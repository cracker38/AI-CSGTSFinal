from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import ensure_default_system_admin, ensure_master_catalogs, ensure_team_assignment_schema
from app.db.session import SessionLocal, engine
from app.models.base import Base
from app.db import base as _  # noqa: F401  (import models)


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/", tags=["health"])
    def root() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    @app.on_event("startup")
    def _startup() -> None:
        # Dev-friendly: ensure schema exists. Use Alembic migrations in production.
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            ensure_team_assignment_schema(db)
            ensure_default_system_admin(db)
            ensure_master_catalogs(db)
        finally:
            db.close()

    return app


app = create_app()
