from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserPublic(BaseModel):
    id: uuid.UUID
    # Stored value may be legacy/invalid; never 500 list endpoints — input schemas still use EmailStr.
    email: str
    full_name: str
    phone_number: str
    country: str
    department: str
    job_title: str
    experience_level: str
    primary_skill: str
    role: str
    status: str
    must_change_password: bool
    manager_id: uuid.UUID | None = None
    created_at: datetime


class EmployeeRegistrationFields(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    phone_number: str = Field(min_length=4, max_length=30)
    country: str = Field(min_length=2, max_length=120)
    department: str = Field(min_length=2, max_length=120)
    job_title: str = Field(min_length=2, max_length=120)
    experience_level: str = Field(pattern="^(Junior|Mid|Senior|Expert)$")
    primary_skill: str = Field(min_length=2, max_length=120)
