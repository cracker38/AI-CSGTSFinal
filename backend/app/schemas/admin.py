from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class AuditLogPublic(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor_user_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str
    meta: dict
    ip_address: str | None
    user_agent: str | None


class SystemKpis(BaseModel):
    total_users: int
    pending_users: int
    active_users: int
    disabled_users: int
    users_by_role: dict[str, int]
    total_skills: int
    total_cv_documents: int
