from __future__ import annotations

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class Skill(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("name", name="uq_skills_name"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)

    users = relationship("UserSkill", back_populates="skill")
