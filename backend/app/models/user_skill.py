from __future__ import annotations

import enum
import uuid

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class SkillSource(str, enum.Enum):
    cv = "cv"
    self = "self"
    manager = "manager"
    ai = "ai"


class UserSkill(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "user_skills"
    __table_args__ = (
        UniqueConstraint("user_id", "skill_id", name="uq_user_skill"),
        CheckConstraint("level >= 0 AND level <= 5", name="ck_user_skills_level_range"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    skill_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("skills.id"), nullable=False, index=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source: Mapped[SkillSource] = mapped_column(Enum(SkillSource, name="skill_source"), nullable=False)

    user = relationship("User", back_populates="skills")
    skill = relationship("Skill", back_populates="users")
