from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


connect_args: dict = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif "postgresql" in settings.database_url:
    # Without this, a stopped Postgres can leave TCP (and login) hanging until the client times out.
    connect_args = {"connect_timeout": 10}

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_timeout=20,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=Session)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
