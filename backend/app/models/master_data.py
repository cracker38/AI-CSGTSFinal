from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampedMixin, UuidPrimaryKeyMixin


class CatalogRequestType(str, enum.Enum):
    department = "department"
    job_title = "job_title"
    skill = "skill"


class CatalogRequestStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class DepartmentCatalog(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "department_catalog"
    __table_args__ = (UniqueConstraint("name", name="uq_department_catalog_name"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class JobTitleCatalog(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "job_title_catalog"
    __table_args__ = (UniqueConstraint("name", name="uq_job_title_catalog_name"),)

    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CatalogRequest(Base, UuidPrimaryKeyMixin, TimestampedMixin):
    __tablename__ = "catalog_requests"

    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    request_type: Mapped[CatalogRequestType] = mapped_column(Enum(CatalogRequestType, name="catalog_request_type"), nullable=False)
    value: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[CatalogRequestStatus] = mapped_column(
        Enum(CatalogRequestStatus, name="catalog_request_status"), nullable=False, default=CatalogRequestStatus.pending
    )
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
