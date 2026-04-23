from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class BackupStatus(str, enum.Enum):
    requested = "requested"
    running = "running"
    completed = "completed"
    failed = "failed"


class BackupJob(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "backup_jobs"

    status: Mapped[BackupStatus] = mapped_column(Enum(BackupStatus, name="backup_status"), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meta: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

