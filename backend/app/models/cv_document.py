from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class CvDocument(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "cv_documents"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    extract: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
