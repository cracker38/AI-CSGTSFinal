from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HrActionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    target_user_id: uuid.UUID
    created_by_id: uuid.UUID
    action_type: str
    status: str
    note: str | None
    payload: dict
    created_at: datetime
    updated_at: datetime


class CvValidationDecisionRequest(BaseModel):
    user_id: uuid.UUID
    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=2000)


class CvFeedbackNoteRequest(BaseModel):
    """HR-only message on the employee's profile (does not change primary-skill validation)."""

    user_id: uuid.UUID
    note: str = Field(..., min_length=1, max_length=2000)


class TrainingAssignRequest(BaseModel):
    user_id: uuid.UUID
    program_name: str = Field(..., min_length=1, max_length=300)
    target_skill: str = Field(..., min_length=1, max_length=200)
    estimated_cost: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)
    official_url: str | None = Field(default=None, max_length=2000)
    provider: str | None = Field(default=None, max_length=200)
    catalog_course_id: str | None = Field(default=None, max_length=120)


class TrainingEnrollmentReviewRequest(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class TrainingAssignmentProgressUpdate(BaseModel):
    """Employee or HR updates real progress on a persisted training assignment."""

    progress_pct: int | None = Field(default=None, ge=0, le=100)
    mark_completed: bool = False
    certificate_status: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=2000)


class MaterialReadingProgressUpdate(BaseModel):
    """Employee in-app viewer: PDF pages studied or video watch position."""

    pdf_total_pages: int | None = Field(default=None, ge=1, le=2000)
    pdf_page_completed: int | None = Field(default=None, ge=1, le=2000)
    video_position_sec: float | None = Field(default=None, ge=0)
    video_duration_sec: float | None = Field(default=None, ge=0)


class ComplianceRenewalRequest(BaseModel):
    user_id: uuid.UUID
    certification: str = Field(..., min_length=1, max_length=500)
    renewed_until: date | None = None
    note: str | None = Field(default=None, max_length=2000)
    required_certification: str | None = Field(default=None, min_length=2, max_length=500)
    due_date: date | None = None


class PromotionRecommendRequest(BaseModel):
    user_id: uuid.UUID
    readiness_score: float | None = Field(default=None, ge=0, le=100)
    note: str | None = Field(default=None, max_length=2000)
