from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class EmployeeProfile(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "employee_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False)

    headline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cv_extract: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    ai_profile: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    user = relationship("User", back_populates="employee_profile")
