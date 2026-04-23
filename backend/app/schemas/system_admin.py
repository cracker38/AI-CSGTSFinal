from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SystemSettingPublic(BaseModel):
    id: uuid.UUID
    key: str
    value: dict
    updated_by_user_id: uuid.UUID | None
    updated_at: datetime


class SystemSettingUpsert(BaseModel):
    key: str = Field(min_length=2, max_length=120)
    value: dict = Field(default_factory=dict)


class IntegrationPublic(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    enabled: bool
    config: dict
    updated_by_user_id: uuid.UUID | None
    updated_at: datetime


class IntegrationUpsert(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    type: str = Field(pattern="^(hris|lms|jira|asana)$")
    enabled: bool = False
    config: dict = Field(default_factory=dict)


class BackupJobPublic(BaseModel):
    id: uuid.UUID
    status: str
    label: str
    requested_by_user_id: uuid.UUID
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    meta: dict


class BackupRequest(BaseModel):
    label: str = Field(min_length=2, max_length=200)

