from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import (
    ensure_archived_account_status,
    ensure_default_system_admin,
    ensure_master_catalogs,
    ensure_project_department_schema,
    ensure_team_assignment_schema,
)
from app.db.session import SessionLocal, engine
from app.models.base import Base
from app.db import base as _  # noqa: F401  (import models)


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)
    static_dir = Path(__file__).resolve().parent / "static"
    assets_dir = static_dir / "assets"

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.middleware("http")
    async def disable_api_browser_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(settings.api_v1_prefix):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    @app.get("/", tags=["ui"], response_model=None)
    def root() -> Response:
        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return JSONResponse({"status": "ok", "service": settings.app_name})

    @app.on_event("startup")
    def _startup() -> None:
        # Dev-friendly: ensure schema exists. Use Alembic migrations in production.
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            ensure_team_assignment_schema(db)
            ensure_project_department_schema(db)
            ensure_archived_account_status(db)
            ensure_default_system_admin(db)
            ensure_master_catalogs(db)
        finally:
            db.close()

    @app.get("/{full_path:path}", tags=["ui"])
    def spa_fallback(full_path: str) -> FileResponse:
        # Preserve API 404 behavior and only fallback for frontend routes.
        if full_path.startswith(settings.api_v1_prefix.lstrip("/")):
            raise HTTPException(status_code=404, detail="Not Found")

        # Serve root-level static files (e.g. favicon.svg) directly when present.
        if "." in Path(full_path).name:
            requested_file = static_dir / full_path
            if requested_file.exists() and requested_file.is_file():
                return FileResponse(requested_file)
            raise HTTPException(status_code=404, detail="Not Found")

        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)

        raise HTTPException(status_code=404, detail="Not Found")

    return app


app = create_app()
