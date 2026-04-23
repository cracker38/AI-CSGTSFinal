from __future__ import annotations

import enum
import uuid
from datetime import date

from sqlalchemy import Date, Enum, Float, ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class ProjectStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class ManagerProject(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "manager_projects"

    manager_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    required_employees: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[ProjectStatus] = mapped_column(Enum(ProjectStatus, name="project_status"), nullable=False)


class ProjectSkillRequirement(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "project_skill_requirements"
    __table_args__ = (UniqueConstraint("project_id", "skill_id", name="uq_project_skill_requirement"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("manager_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("skills.id"), nullable=False, index=True)
    required_level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)


class ProjectAssignment(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "project_assignments"
    __table_args__ = (UniqueConstraint("project_id", "employee_id", name="uq_project_assignment"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("manager_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    allocation_pct: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)


class ProjectJobTitleRequirement(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "project_job_title_requirements"
    __table_args__ = (UniqueConstraint("project_id", "job_title", name="uq_project_job_title_requirement"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("manager_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_title: Mapped[str] = mapped_column(String(120), nullable=False, index=True)


class EmployeeProjectDailyReport(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "employee_project_daily_reports"
    __table_args__ = (UniqueConstraint("project_id", "employee_id", "work_date", name="uq_daily_report_per_day"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("manager_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    hours_spent: Mapped[float] = mapped_column(Float, nullable=False, default=8.0)
    progress_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="in_progress")
    summary: Mapped[str] = mapped_column(String(1200), nullable=False, default="")
    blockers: Mapped[str] = mapped_column(String(1200), nullable=False, default="")
    next_plan: Mapped[str] = mapped_column(String(1200), nullable=False, default="")
