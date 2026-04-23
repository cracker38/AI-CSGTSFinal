from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, Enum, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class IntegrationType(str, enum.Enum):
    hris = "hris"
    lms = "lms"
    jira = "jira"
    asana = "asana"


class Integration(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("name", name="uq_integrations_name"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    type: Mapped[IntegrationType] = mapped_column(Enum(IntegrationType, name="integration_type"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True, index=True)

