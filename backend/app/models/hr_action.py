from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class HrAction(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    """Persisted HR decisions for workforce actions (auditable via AuditLog + this table)."""

    __tablename__ = "hr_actions"

    target_user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)

    action_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    note: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
